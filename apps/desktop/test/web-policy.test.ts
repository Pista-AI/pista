import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedPanePermissions, decidePanePermission, isWebUrl, sameOrigin } from "../src/web-policy.ts";

test("isWebUrl accepts http, https and about:blank only", () => {
  for (const url of ["http://a.test/", "https://a.test/x?y=1", "about:blank", "HTTPS://A.TEST"]) assert.equal(isWebUrl(url), true, url);
  for (const url of ["file:///etc/hosts", "mailto:a@b.c", "javascript:alert(1)", "data:text/html,hi", "chrome://gpu", "ftp://a.test", "about:srcdoc", "not a url", ""])
    assert.equal(isWebUrl(url), false, url);
});

test("pane permissions: only clipboard writes and fullscreen are allowed", () => {
  assert.deepEqual([...allowedPanePermissions].sort(), ["clipboard-sanitized-write", "fullscreen"]);
  for (const p of ["media", "geolocation", "notifications", "midi", "pointerLock", "openExternal", "clipboard-read", "display-capture", "idle-detection", "hid", "serial", "usb", "window-management", "keyboardLock", "storage-access", "speaker-selection", "unknown"])
    assert.equal(decidePanePermission(p), false, p);
  assert.equal(decidePanePermission("fullscreen"), true);
});

test("sameOrigin compares scheme, host and port", () => {
  assert.equal(sameOrigin("http://localhost:5320/", "http://localhost:5320/a/b?c"), true);
  assert.equal(sameOrigin("http://localhost:5320/", "http://localhost:5321/"), false);
  assert.equal(sameOrigin("http://localhost:5320/", "https://localhost:5320/"), false);
  assert.equal(sameOrigin("http://localhost:5320/", "file:///etc/hosts"), false);
  assert.equal(sameOrigin("file:///a", "file:///a"), false);
  assert.equal(sameOrigin("junk", "junk"), false);
});
