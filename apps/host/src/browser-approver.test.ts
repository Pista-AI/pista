import assert from "node:assert/strict";
import { test } from "node:test";
import { setupHome } from "./test-helpers.ts";

setupHome("browser-approver-test", { cleanup: "exit" });
const { browserApprover } = await import("./extensions.ts");
const { Hub } = await import("./hub.ts");

/** A connected window that records the frames the host sends. */
function window(hub: InstanceType<typeof Hub>) {
  const frames: { kind: string; event: Record<string, unknown> }[] = [];
  const ws = { readyState: 1, OPEN: 1, on: () => {}, send: (frame: string) => frames.push(JSON.parse(frame)) };
  hub.add(ws as never);
  return { frames, requests: () => frames.filter((f) => f.event.type === "approval.request").map((f) => f.event), resolved: () => frames.filter((f) => f.event.type === "approval.resolved").map((f) => f.event.approvalId) };
}

const ref = { threadId: "t1" } as never;

test("the ask carries the exact action as title, a reason, no always-allow route, and resolves with the user's answer", async () => {
  const hub = new Hub();
  const w = window(hub);
  const answer = browserApprover(hub, ref)({ toolName: "browser_click", action: 'clicking button "Place order"' });
  const [req] = w.requests();
  assert.deepEqual({ ...req, approvalId: undefined }, {
    type: "approval.request",
    approvalId: undefined,
    threadId: "t1",
    toolName: "browser_click",
    args: { action: 'clicking button "Place order"' },
    reason: 'clicking button "Place order" looks like a consequential action (buying, paying, sending, deleting, signing in or out)',
    action: 'clicking button "Place order"',
  });
  hub.settle(req!.approvalId as string, { allow: true, always: true });
  assert.equal(await answer, true, "yes");
  const no = browserApprover(hub, ref)({ toolName: "browser_click", action: "x" });
  hub.settle(w.requests()[1]!.approvalId as string, { allow: false });
  assert.equal(await no, false);
});

test("with no window connected the ask is rejected", async () => {
  await assert.rejects(browserApprover(new Hub(), ref)({ toolName: "browser_click", action: "x" }), /No Pista window is connected/);
});

test("an unanswered ask times out and its card is withdrawn", async () => {
  const hub = new Hub();
  const w = window(hub);
  await assert.rejects(browserApprover(hub, ref, 20)({ toolName: "browser_click", action: "x" }), /Timed out/);
  assert.deepEqual(w.resolved(), [w.requests()[0]!.approvalId]);
});

test("aborting withdraws the ask, and a late yes finds nothing to answer", async () => {
  const hub = new Hub();
  const w = window(hub);
  const stop = new AbortController();
  const answer = browserApprover(hub, ref)({ toolName: "browser_click", action: "x", signal: stop.signal });
  stop.abort();
  await assert.rejects(answer, /Aborted/);
  const id = w.requests()[0]!.approvalId as string;
  assert.deepEqual(w.resolved(), [id]);
  hub.settle(id, { allow: true });
});

test("two concurrent asks resolve to their own calls, whatever order the user answers in", async () => {
  const hub = new Hub();
  const w = window(hub);
  const first = browserApprover(hub, ref)({ toolName: "browser_click", action: "first" });
  const second = browserApprover(hub, ref)({ toolName: "browser_type", action: "second" });
  const [a, b] = w.requests();
  assert.notEqual(a!.approvalId, b!.approvalId);
  hub.settle(b!.approvalId as string, { allow: false });
  hub.settle(a!.approvalId as string, { allow: true });
  assert.equal(await first, true);
  assert.equal(await second, false);
  assert.equal(a!.action, "first");
  assert.equal(b!.action, "second");
});
