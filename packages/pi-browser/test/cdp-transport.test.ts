import assert from "node:assert/strict";
import { test } from "node:test";
import type { CdpEvent, CdpTransport } from "../src/chrome/pipe.ts";
import { CdpDriver } from "../src/drivers/cdp.ts";

function fakeTransport(failOn?: string) {
  const calls: { method: string; sessionId?: string }[] = [];
  const closers: ((e: Error) => void)[] = [];
  const transport: CdpTransport = {
    async send(method, _params, sessionId) {
      calls.push({ method, sessionId });
      if (method === failOn) throw new Error("setup failed");
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "F1" } } };
      if (method === "Runtime.evaluate") return { result: { value: { url: "https://example.com/", title: "Example" } } };
      return {};
    },
    onEvent: (_h: (e: CdpEvent) => void) => {},
    onClose: (h) => void closers.push(h),
    close: () => {},
  };
  return { transport, calls, die: () => closers.splice(0).forEach((h) => h(new Error("gone"))) };
}

class TestDriver extends CdpDriver {
  attached = 0;
  failed = 0;
  constructor(private t: ReturnType<typeof fakeTransport>, private failFirst = false) {
    super("");
  }
  protected async openTransport() {
    return { transport: this.t.transport, sessionId: "S1" };
  }
  protected async onAttached() {
    if (this.failFirst && this.attached++ === 0) throw new Error("setup failed");
  }
  protected async onAttachFailed() {
    this.failed++;
  }
}

test("the driver runs on any transport and addresses the page session", async () => {
  const t = fakeTransport();
  const state = await new TestDriver(t).state();
  assert.equal(state.title, "Example");
  assert.ok(t.calls.every((c) => c.sessionId === "S1"));
});

test("a failed setup drops the connection, runs nothing on the page, and the next call retries", async () => {
  const t = fakeTransport();
  const d = new TestDriver(t, true);
  await assert.rejects(d.state(), /setup failed/);
  assert.equal(d.failed, 1);
  assert.ok(!t.calls.some((c) => c.method === "Runtime.evaluate"));
  assert.equal((await d.state()).title, "Example");
});

test("a closed transport is reconnected on the next call", async () => {
  const t = fakeTransport();
  const d = new TestDriver(t);
  await d.state();
  t.die();
  await d.state();
  assert.equal(t.calls.filter((c) => c.method === "Page.enable").length, 2);
});
