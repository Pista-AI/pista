// Playbook content is untrusted data (it may be model-written or edited on disk): validate it, never inject it as instructions.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDomain } from "tldts";
import type { Playbook, PlaybookExpect, PlaybookLocator, PlaybookMeta, PlaybookStep } from "@pista/protocol";
import { CLIENT_DIR } from "./pi-env.ts";

/** Consecutive failures after which a playbook is flagged "needs-attention". */
export const FAIL_THRESHOLD = 3;
export const MAX_STEPS = 30;
export const MAX_FALLBACKS = 5;
const MAX_HISTORY = 20;
const MAX_TEXT = 200;
const MAX_SELECTOR = 300;

// Resolved at call time so tests can point PISTA_HOME at a temp dir.
const dir = () => join(process.env.PISTA_HOME ?? CLIENT_DIR, "playbooks");

function parseHttp(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("invalid url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("url must be http(s)");
  return u;
}

/** Registrable domain of an http(s) URL, lowercase; the hostname for IPs and localhost. */
export function siteKey(url: string): string {
  const u = parseHttp(url);
  return (getDomain(u.hostname) ?? u.hostname).toLowerCase();
}

const SECRET_KEY = /token|code|state|nonce|session|sid|auth|key|signature|^sig$|expires|otp|password|pwd|pass|ticket|jwt|access|refresh|secret|credential|saml|^utm_/i;
const OPAQUE_VALUE = /^[A-Za-z0-9_\-.~%+/=]{32,}$/;

/** Same-site http(s) URL without userinfo, fragment, secret-looking query params or long opaque values. Throws otherwise. */
export function sanitizeUrl(url: string, site: string): string {
  const u = parseHttp(url);
  if (u.username || u.password) throw new Error("url must not contain credentials");
  if (siteKey(url) !== site) throw new Error("url is on a different site");
  u.hash = "";
  for (const [k, v] of [...u.searchParams.entries()]) {
    if (SECRET_KEY.test(k) || OPAQUE_VALUE.test(v)) u.searchParams.delete(k);
  }
  return u.toString();
}

const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("expected an object");
  return v as Record<string, unknown>;
};
/** Over-long strings are truncated, not rejected. */
const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v ? v.slice(0, max) : undefined);

function locator(v: unknown, site: string): PlaybookLocator {
  const o = obj(v);
  const out: PlaybookLocator = {};
  const role = str(o.role, MAX_TEXT), name = str(o.name, MAX_TEXT), text = str(o.text, MAX_TEXT), selector = str(o.selector, MAX_SELECTOR);
  if (role) out.role = role;
  if (name) out.name = name;
  if (text) out.text = text;
  if (selector) out.selector = selector;
  if (typeof o.frameUrl === "string" && o.frameUrl) out.frameUrl = sanitizeUrl(o.frameUrl, site);
  return out;
}

function expectOf(v: unknown, site: string): PlaybookExpect | undefined {
  if (v === undefined || v === null) return undefined;
  const o = obj(v);
  const out: PlaybookExpect = {};
  const urlIncludes = str(o.urlIncludes, MAX_TEXT), text = str(o.text, MAX_TEXT);
  if (urlIncludes) out.urlIncludes = urlIncludes;
  if (text) out.text = text;
  if (o.element !== undefined) out.element = locator(o.element, site);
  return out;
}

function step(v: unknown, site: string): PlaybookStep {
  const o = obj(v);
  const expect = expectOf(o.expect, site);
  const withExpect = expect ? { expect } : {};
  switch (o.kind) {
    case "navigate":
      return { kind: "navigate", url: sanitizeUrl(String(o.url), site), ...withExpect };
    case "click": {
      const fb = Array.isArray(o.fallbacks) ? o.fallbacks : [];
      if (fb.length > MAX_FALLBACKS) throw new Error(`too many fallbacks (max ${MAX_FALLBACKS})`);
      return { kind: "click", target: locator(o.target, site), ...(fb.length ? { fallbacks: fb.map((f) => locator(f, site)) } : {}), ...withExpect };
    }
    case "signIn": {
      const origin = parseHttp(String(o.origin));
      if (siteKey(origin.href) !== site) throw new Error("signIn origin is on a different site");
      return { kind: "signIn", origin: origin.origin, ...withExpect };
    }
    case "wait":
      if (!expect) throw new Error("wait step needs expect");
      return { kind: "wait", expect };
    case "download": {
      const out: Extract<PlaybookStep, { kind: "download" }> = { kind: "download" };
      if (o.target !== undefined) out.target = locator(o.target, site);
      if (typeof o.url === "string" && o.url) out.url = sanitizeUrl(o.url, site);
      const fileType = str(o.fileType, 20);
      if (fileType) out.fileType = fileType;
      return out;
    }
    default:
      throw new Error("unknown step kind");
  }
}

/** Builds a fresh Playbook from untrusted input, keeping known fields only. Throws with a short reason. */
export function validatePlaybook(input: unknown, site: string): Playbook {
  const o = obj(input);
  if (!Array.isArray(o.steps)) throw new Error("steps must be an array");
  if (o.steps.length > MAX_STEPS) throw new Error(`too many steps (max ${MAX_STEPS})`);
  const now = new Date().toISOString();
  const date = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : undefined);
  const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);
  const history = Array.isArray(o.history)
    ? o.history.flatMap((h) => {
        try {
          const e = obj(h);
          const at = date(e.at), summary = str(e.summary, MAX_TEXT);
          return at && summary ? [{ at, summary }] : [];
        } catch {
          return [];
        }
      }).slice(-MAX_HISTORY)
    : [];
  return {
    version: 1,
    site,
    startUrl: sanitizeUrl(String(o.startUrl), site),
    steps: o.steps.map((s) => step(s, site)),
    createdAt: date(o.createdAt) ?? now,
    updatedAt: date(o.updatedAt) ?? now,
    ...(date(o.lastSucceeded) ? { lastSucceeded: date(o.lastSucceeded) } : {}),
    successCount: count(o.successCount),
    failCount: count(o.failCount),
    status: o.status === "needs-attention" ? "needs-attention" : "ok",
    history,
  };
}

function fileFor(site: string): string {
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(site) || site.includes("..")) throw new Error("invalid site");
  return join(dir(), `${site}.json`);
}

export function getPlaybook(site: string): Playbook | null {
  const file = fileFor(site);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    return validatePlaybook(JSON.parse(raw), site);
  } catch {
    return null; // corrupt or tampered file: treat as absent
  }
}

export function savePlaybook(pb: Playbook): void {
  const file = fileFor(pb.site);
  const clean = validatePlaybook(pb, pb.site);
  mkdirSync(dir(), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(clean, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}

export function deletePlaybook(site: string): void {
  rmSync(fileFor(site), { force: true });
}

export function listPlaybooks(): PlaybookMeta[] {
  let names: string[];
  try {
    names = readdirSync(dir());
  } catch {
    return [];
  }
  const out: PlaybookMeta[] = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    const pb = getPlaybook(n.slice(0, -5));
    if (!pb) continue;
    out.push({ site: pb.site, startUrl: pb.startUrl, stepCount: pb.steps.length, status: pb.status, lastSucceeded: pb.lastSucceeded, successCount: pb.successCount, failCount: pb.failCount, updatedAt: pb.updatedAt });
  }
  return out.sort((a, b) => a.site.localeCompare(b.site));
}

function mutate(site: string, fn: (pb: Playbook, now: string) => void): Playbook | null {
  const pb = getPlaybook(site);
  if (!pb) return null;
  const now = new Date().toISOString();
  fn(pb, now);
  pb.updatedAt = now;
  pb.history = pb.history.slice(-MAX_HISTORY);
  savePlaybook(pb);
  return pb;
}

export function recordSuccess(site: string): Playbook | null {
  return mutate(site, (pb, now) => {
    pb.successCount++;
    pb.failCount = 0;
    pb.status = "ok";
    pb.lastSucceeded = now;
    pb.history.push({ at: now, summary: "replay succeeded" });
  });
}

export function recordFailure(site: string): Playbook | null {
  return mutate(site, (pb, now) => {
    pb.failCount++;
    if (pb.failCount >= FAIL_THRESHOLD) pb.status = "needs-attention";
    pb.history.push({ at: now, summary: "replay failed" });
  });
}
