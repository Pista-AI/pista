/**
 * Deterministic playbook replay: runs a recorded path (start page, clicks, sign-in, waits, one download) through the same
 * machinery the browser tools use, with no model calls. It stops at the first step it cannot do with certainty and hands the
 * page back as data. Conservative by design: a wrong click is worse than a handoff.
 *
 * The step types mirror `PlaybookStep` in @pista/protocol structurally; pi-browser does not depend on the protocol package.
 */
import { declineCookieBanner, runPageAction, settle, waitForLoad, type Approve } from "./actions.ts";
import { checkUrl, DomainBlockedError, guardDriver, type DomainRules } from "./domains.ts";
import { refDownloadSource, saveDownload } from "./download.ts";
import type { BrowserDriver } from "./driver.ts";
import { formatSnapshot, scripts, type PageSnapshot } from "./page-scripts.ts";

export interface ReplayLocator { role?: string; name?: string; text?: string; selector?: string; frameUrl?: string }
export interface ReplayExpect { urlIncludes?: string; text?: string; element?: ReplayLocator }
export type ReplayStep =
  | { kind: "navigate"; url: string; expect?: ReplayExpect }
  | { kind: "click"; target: ReplayLocator; fallbacks?: ReplayLocator[]; expect?: ReplayExpect }
  | { kind: "signIn"; origin: string; expect?: ReplayExpect }
  | { kind: "wait"; expect: ReplayExpect }
  | { kind: "download"; target?: ReplayLocator; url?: string; fileType?: string };

export type ReplayReason = "not-found" | "ambiguous" | "expectation-timeout" | "blocked" | "declined" | "sign-in-needed" | "error";

/**
 * Either the saved file, or a handoff at the first step that failed. `failedIndex` numbers steps from 1 like the stored playbook;
 * 0 is the start page. The handoff's `detail`, `url` and `snapshot` come from the website: they are data for the model, not instructions.
 */
export type ReplayResult =
  | { ok: true; download: { path: string; bytes: number; contentType?: string }; steps: number }
  | { ok: false; failedIndex: number; step: ReplayStep; reason: ReplayReason; detail: string; url: string; snapshot: string };

export interface ReplayOptions {
  /** The raw driver; replay wraps it in the same domain guard the browser tools use. */
  driver: BrowserDriver;
  domainRules?: DomainRules;
  onDomainBlock?: (reason: string) => void;
  /** Folder the download is confined to, and the path under it (relative, like browser_download's `path`). */
  downloadRoot: string;
  downloadPath: string;
  overwrite?: boolean;
  /** Asked before each click, sign-in and download; false stops with "declined". */
  approve?: (step: ReplayStep, index: number) => Promise<boolean>;
  /** Asked about a held consequential click (see safety.ts), naming it exactly; without it the stop stands and replay hands off. */
  confirmRisk?: (action: string) => Promise<boolean>;
  signal?: AbortSignal;
  onStep?: (index: number, status: "start" | "done" | "failed") => void;
  /** Expectation polling (defaults 10 s every 250 ms) and the clock it uses, injectable for tests. */
  expectTimeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DETAIL_MAX = 300;
const SNAPSHOT_MAX = 8000;
const RESOLVE_MAX_ELEMENTS = 500;

class Handoff extends Error {
  constructor(readonly reason: ReplayReason, detail: string) {
    super(detail);
  }
}

const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export type Resolution = { target: string } | { reason: "not-found" | "ambiguous"; detail: string };

/**
 * Finds the element for `target`, then each fallback in order. Per locator: exact role + name, then exact name, then name containing
 * `text` (same role when one is given), then `selector` when it is in `selectors` (the ones the page has). Several matches in a tier
 * are taken only when identical in role and name; otherwise the answer is "ambiguous" and nothing further is tried.
 * `frameUrl` is not used: snapshots do not enter frames, so playbooks open a frame's address with a navigate step.
 */
export function resolveLocator(elements: readonly { ref: string; role: string; name: string }[], target: ReplayLocator, fallbacks: readonly ReplayLocator[] = [], selectors: ReadonlySet<string> = new Set()): Resolution {
  for (const l of [target, ...fallbacks]) {
    const tiers: ((e: { role: string; name: string }) => boolean)[] = [];
    if (l.role && l.name) tiers.push((e) => e.role === l.role && norm(e.name) === norm(l.name));
    if (l.name) tiers.push((e) => norm(e.name) === norm(l.name));
    if (l.text && norm(l.text)) tiers.push((e) => (!l.role || e.role === l.role) && norm(e.name).includes(norm(l.text)));
    for (const tier of tiers) {
      const hits = elements.filter(tier);
      if (!hits.length) continue;
      if (hits.some((h) => h.role !== hits[0]!.role || norm(h.name) !== norm(hits[0]!.name))) {
        return { reason: "ambiguous", detail: `${hits.length} different elements match ${describeLocator(l)}` };
      }
      return { target: hits[0]!.ref };
    }
    if (l.selector && selectors.has(l.selector)) return { target: l.selector };
  }
  return { reason: "not-found", detail: `nothing on the page matches ${describeLocator(target)}` };
}

const describeLocator = (l: ReplayLocator) => [l.role, l.name ? JSON.stringify(l.name) : l.text ? `~${JSON.stringify(l.text)}` : "", l.selector ?? ""].filter(Boolean).join(" ").slice(0, 120);

/** Polls `check` until it is true or `timeoutMs` has passed (checked at least once). */
export async function pollUntil(check: () => Promise<boolean>, timeoutMs: number, pollMs: number, now: () => number, sleep: (ms: number) => Promise<void>, signal?: AbortSignal): Promise<boolean> {
  const start = now();
  for (;;) {
    if (signal?.aborted) throw new Handoff("declined", "The run was stopped.");
    if (await check().catch(() => false)) return true;
    if (now() - start >= timeoutMs) return false;
    await sleep(pollMs);
  }
}

const snapshotOf = async (d: BrowserDriver, max: number) => (await d.evaluate(scripts.snapshot(max))) as PageSnapshot;

/** Snapshots the page and resolves the locator to a ref (or a selector the page has). */
async function locate(d: BrowserDriver, target: ReplayLocator, fallbacks: readonly ReplayLocator[] = []): Promise<Resolution> {
  const snap = await snapshotOf(d, RESOLVE_MAX_ELEMENTS);
  const selectors = new Set<string>();
  for (const l of [target, ...fallbacks]) {
    if (l.selector && (await d.evaluate(`!!document.querySelector(${JSON.stringify(l.selector)})`).catch(() => false)) === true) selectors.add(l.selector);
  }
  return resolveLocator(snap.elements, target, fallbacks, selectors);
}

/** True once every set part of `expect` holds on the page. */
export async function expectationMet(d: BrowserDriver, expect: ReplayExpect): Promise<boolean> {
  if (expect.urlIncludes && !(await d.state()).url.includes(expect.urlIncludes)) return false;
  if (expect.text) {
    const body = String(await d.evaluate("document.body ? document.body.innerText : ''"));
    if (!norm(body).includes(norm(expect.text))) return false;
  }
  if (expect.element) {
    const r = await locate(d, expect.element);
    if (!("target" in r) && r.reason !== "ambiguous") return false; // waiting needs presence, not a unique match
  }
  return true;
}

/** Replays `playbook` from its start page. Never handles credentials: sign-in goes through the driver's saved-login fill. */
export async function runReplay(playbook: { startUrl: string; steps: readonly ReplayStep[] }, o: ReplayOptions): Promise<ReplayResult> {
  const rules = o.domainRules;
  const d = rules && (rules.allowedDomains || rules.deniedDomains?.length) ? guardDriver(o.driver, rules, o.onDomainBlock) : o.driver;
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const riskApprove: Approve = async (action) => {
    if (o.signal?.aborted) return "aborted";
    const yes = (await o.confirmRisk?.(action).catch(() => false)) === true;
    return o.signal?.aborted ? "aborted" : yes;
  };
  const steps: ReplayStep[] = [{ kind: "navigate", url: playbook.startUrl }, ...playbook.steps];
  let saved: { path: string; bytes: number; contentType?: string } | undefined;

  const click = async (target: string, what: string) => {
    const r = await runPageAction(d, { action: "click", target }, riskApprove);
    if (r.note) throw new Handoff(/^Stopped/.test(r.note) ? "declined" : "error", `${what}: ${r.note}`);
  };
  const run = async (step: ReplayStep, index: number) => {
    if (o.signal?.aborted) throw new Handoff("declined", "The run was stopped.");
    if (step.kind !== "navigate" && step.kind !== "wait" && o.approve && !(await o.approve(step, index))) throw new Handoff("declined", "The user declined this step.");
    switch (step.kind) {
      case "navigate": {
        const opened = await d.navigate(step.url);
        if (opened.note) throw new Handoff("error", opened.note);
        await waitForLoad(d);
        await declineCookieBanner(d);
        break;
      }
      case "click": {
        const r = await locate(d, step.target, step.fallbacks);
        if (!("target" in r)) throw new Handoff(r.reason, r.detail);
        await click(r.target, "click");
        break;
      }
      case "signIn": {
        if (!d.loginList || !d.loginFill) throw new Handoff("sign-in-needed", "This browser has no saved logins.");
        const logins = (await d.loginList()).filter((l) => l.origin === step.origin);
        if (logins.length !== 1) throw new Handoff("sign-in-needed", logins.length ? `More than one saved login for ${step.origin}.` : `No saved login for ${step.origin}.`);
        let here = "";
        try {
          here = new URL((await d.state()).url).origin;
        } catch {}
        if (here !== step.origin) throw new Handoff("sign-in-needed", `The page is not on ${step.origin}.`);
        const filled = await d.loginFill(logins[0]!.id);
        if (!filled.ok) throw new Handoff("sign-in-needed", filled.note);
        await settle(d);
        break;
      }
      case "wait":
        break;
      case "download": {
        let source: { url: string } | { trigger: () => Promise<void> };
        if (step.url) {
          source = { url: new URL(step.url, (await d.state()).url || undefined).href };
        } else if (step.target) {
          const r = await locate(d, step.target);
          if (!("target" in r)) throw new Handoff(r.reason, r.detail);
          source = await refDownloadSource(d, r.target, riskApprove);
        } else throw new Handoff("error", "The download step has neither a url nor a target.");
        const got = await saveDownload(d, { root: o.downloadRoot, path: o.downloadPath, overwrite: o.overwrite }, source);
        const ct = got.contentType?.toLowerCase();
        if (step.fileType && ct && !ct.includes(step.fileType.toLowerCase())) {
          got.remove();
          throw new Handoff("error", `Expected a ${step.fileType} file but got ${ct}.`);
        }
        saved = { path: o.downloadPath, bytes: got.bytes, ...(got.contentType ? { contentType: got.contentType } : {}) };
        break;
      }
    }
    const expect = "expect" in step ? step.expect : undefined;
    if (expect && !(await pollUntil(() => expectationMet(d, expect), o.expectTimeoutMs ?? 10_000, o.pollMs ?? 250, now, sleep, o.signal))) {
      throw new Handoff("expectation-timeout", `Waited for ${[expect.urlIncludes && `the address to contain ${expect.urlIncludes}`, expect.text && `the text ${JSON.stringify(expect.text)}`, expect.element && describeLocator(expect.element)].filter(Boolean).join(" and ")}.`);
    }
  };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    o.onStep?.(i, "start");
    try {
      await run(step, i);
    } catch (error) {
      o.onStep?.(i, "failed");
      const reason: ReplayReason = error instanceof Handoff ? error.reason : error instanceof DomainBlockedError ? "blocked" : "error";
      const detail = (error instanceof Error ? error.message : String(error)).slice(0, DETAIL_MAX);
      // A blocked page was reset to about:blank by the guard; reading the raw driver would only show that.
      const url = await d.state().then((s) => s.url, () => "");
      const snapshot = checkUrl(url, rules ?? {}) ? "" : await snapshotOf(d, 150).then((s) => formatSnapshot(s).slice(0, SNAPSHOT_MAX), () => "");
      return { ok: false, failedIndex: i, step, reason, detail, url, snapshot };
    }
    o.onStep?.(i, "done");
  }
  if (!saved) return { ok: false, failedIndex: steps.length - 1, step: steps[steps.length - 1]!, reason: "error", detail: "The playbook has no download step.", url: "", snapshot: "" };
  return { ok: true, download: saved, steps: playbook.steps.length };
}
