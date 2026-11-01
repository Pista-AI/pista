import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserAction, BrowserResult, SavedLoginMeta } from "../src/index.ts";

const FORBIDDEN = /"(password|secret|blob)":/i;

type Secret = "password" | "secret" | "blob" | "passwd" | "token" | "credential";
type NoSecretKeys<T> = Extract<keyof T, Secret> extends never ? true : false;
const _metaGuard: NoSecretKeys<SavedLoginMeta> = true;
const _resultGuard: NoSecretKeys<NonNullable<BrowserResult["login"]>> = true;
const _resultKeys: keyof NonNullable<BrowserResult["login"]> extends "ok" | "note" ? true : false = true;
void [_metaGuard, _resultGuard, _resultKeys];

test("saved-login types carry no password-like keys", () => {
  const meta: SavedLoginMeta = { id: "l1", label: "Acme", origin: "https://acme.example", username: "me" };
  const result: BrowserResult = { logins: [meta], login: { ok: true, note: "filled and submitted" } };
  assert.doesNotMatch(JSON.stringify(meta), FORBIDDEN);
  assert.doesNotMatch(JSON.stringify(result), FORBIDDEN);
});

test("login ops are valid browser actions", () => {
  const actions: BrowserAction[] = [{ action: "login.list" }, { action: "login.fill", site: "Acme" }];
  assert.deepEqual(
    actions.map((a) => a.action),
    ["login.list", "login.fill"],
  );
});
