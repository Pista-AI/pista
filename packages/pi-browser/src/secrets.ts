import { randomUUID } from "node:crypto";
import type { BrowserDriver } from "./driver.ts";
import { cutMarker, scripts } from "./page-scripts.ts";

/** Longest eval result handed to the model; the page redacts secrets before this cut. */
const MAX_EVAL_CHARS = 100_000;
const COMPILE_ERROR = /SyntaxError|Unexpected (?:token|identifier|end of input|string|number|reserved)|Invalid or unexpected token|missing \) after/;
const UNCHECKED = "The result was not returned: the page could not be checked for secret field values.";

/**
 * Runs `script` in the page and returns the result as the text for the model, with every secret field's value (password, card
 * number, code ...) replaced by [redacted]. Result and error text are scrubbed in the page in the same evaluation, so the values
 * never reach the host and the script cannot act between running and scrubbing. The source is inlined into the one script sent to the page
 * (no eval, so a CSP without unsafe-eval does not matter): first as an expression, then as a function body if that does not compile. Fails closed: if that evaluation does not report
 * back, nothing is returned. A script that threw becomes an Error carrying the scrubbed text.
 */
export async function evaluateScrubbed(d: BrowserDriver, script: string): Promise<string> {
  const nonce = randomUUID();
  // Driver errors (policy blocks, timeouts, a closed browser) carry no page data and pass through; page errors never get here.
  const run = (form: "expression" | "statements") => d.evaluate(scripts.evalScrubbed(script, form, nonce)) as Promise<{ ok?: unknown; text?: unknown; nonce?: unknown } | undefined>;
  let r;
  try {
    r = await run("expression");
  } catch (error) {
    // A compile error means nothing ran (the wrapper catches everything the script itself throws), so trying again cannot repeat an effect.
    if (!COMPILE_ERROR.test(String((error as { message?: unknown } | undefined)?.message ?? ""))) throw error;
    r = await run("statements");
  }
  // Only the wrapper knows the nonce; a result without it came from code that got out of the wrapper and was not scrubbed.
  if (r?.nonce !== nonce || typeof r.text !== "string") throw new Error(UNCHECKED);
  const text = r.text.length > MAX_EVAL_CHARS ? `${r.text.slice(0, MAX_EVAL_CHARS)}${cutMarker(r.text.length - MAX_EVAL_CHARS, "chars", "return less data")}` : r.text;
  if (r.ok !== true) throw new Error(text);
  return text;
}

/** A screenshot for the model with secret fields drawn as dots. The style is removed again right after capture; the mask failing means no screenshot. */
export async function screenshotMasked(d: BrowserDriver): Promise<{ data: string; mimeType: string }> {
  try {
    await d.evaluate(scripts.secrets("mask"));
  } catch {
    await d.evaluate(scripts.secrets("unmask")).catch(() => undefined);
    throw new Error("No screenshot: secret fields on the page could not be hidden.");
  }
  try {
    return await d.screenshot();
  } finally {
    await d.evaluate(scripts.secrets("unmask")).catch(() => console.warn("browser_screenshot: could not remove the secret-field mask from the page."));
  }
}
