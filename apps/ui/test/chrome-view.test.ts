import test from "node:test";
import assert from "node:assert/strict";
import type { HostEvent } from "@pista/protocol";
import { frameLabel, frameSrc } from "../src/lib/chrome-view.ts";

const frame = { data: "QUJD", width: 1280, height: 720, url: "https://example.com/a", title: "" };

test("a browser.frame event survives a JSON round trip as a protocol event", () => {
  const event: HostEvent = { type: "browser.frame", ...frame };
  const back = JSON.parse(JSON.stringify({ kind: "evt", event })).event as HostEvent;
  assert.deepEqual(back, event);
});
test("builds the image source and a header label", () => {
  assert.equal(frameSrc(frame), "data:image/jpeg;base64,QUJD");
  assert.equal(frameLabel(frame), "example.com");
  assert.equal(frameLabel({ ...frame, title: "Inbox" }), "Inbox");
});
