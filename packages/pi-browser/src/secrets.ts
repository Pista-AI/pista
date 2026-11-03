import type { BrowserDriver } from "./driver.ts";
import { scripts } from "./page-scripts.ts";

/**
 * Runs `script` in the page and returns the result as the text for the model, with every secret field's value (password, card
 * number, code ...) replaced by [redacted]. The scrub runs in the page, so the values never reach the host. It fails closed: if the
 * scrub cannot run, nothing is returned. Password fields are marked first, so a script that reveals one (type=text) is still scrubbed.
 */
export async function evaluateScrubbed(d: BrowserDriver, script: string): Promise<string> {
  await d.evaluate(scripts.secrets("mark"));
  const value = await d.evaluate(script);
  const text = JSON.stringify(value ?? null, null, 2);
  let scrubbed: unknown;
  try {
    scrubbed = await d.evaluate(scripts.secrets("scrub", text));
  } catch {
    throw new Error("The result was not returned: the page could not be checked for secret field values.");
  }
  if (typeof scrubbed !== "string") throw new Error("The result was not returned: the page could not be checked for secret field values.");
  return scrubbed;
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
    await d.evaluate(scripts.secrets("unmask")).catch(() => undefined);
  }
}
