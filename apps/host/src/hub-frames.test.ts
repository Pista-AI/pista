import assert from "node:assert/strict";
import { test } from "node:test";
import { Hub } from "./hub.ts";

function fakeWs(buffered = 0) {
  const sent: string[] = [];
  const handlers: Record<string, () => void> = {};
  const ws: any = { OPEN: 1, readyState: 1, bufferedAmount: buffered, send: (s: string) => sent.push(s), on: (e: string, h: () => void) => (handlers[e] = h) };
  return { ws, sent, close: () => handlers.close() };
}
const frame = { data: "A", width: 1, height: 1, url: "u", title: "t" };

test("only subscribed windows get frames; a slow socket is skipped; counts are reported", () => {
  const hub = new Hub();
  const a = fakeWs();
  const b = fakeWs();
  const slow = fakeWs(10 * 1024 * 1024);
  for (const c of [a, b, slow]) hub.add(c.ws);
  const counts: number[] = [];
  hub.onViewersChanged((n) => counts.push(n));
  hub.setViewer(a.ws, true);
  hub.setViewer(slow.ws, true);
  hub.emitFrame(frame);
  assert.equal(a.sent.length, 1);
  assert.equal(JSON.parse(a.sent[0]).event.type, "browser.frame");
  assert.equal(b.sent.length, 0);
  assert.equal(slow.sent.length, 0);
  a.close();
  slow.close();
  assert.deepEqual(counts, [1, 2, 1, 0]);
});

test("the closed signal reaches only subscribed windows", () => {
  const hub = new Hub();
  const a = fakeWs();
  const b = fakeWs();
  hub.add(a.ws);
  hub.add(b.ws);
  hub.setViewer(a.ws, true);
  hub.emitClosed();
  assert.equal(JSON.parse(a.sent[0]).event.type, "browser.closed");
  assert.equal(b.sent.length, 0);
});
