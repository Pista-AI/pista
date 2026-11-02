import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { startHeartbeat } from "./ws-heartbeat.ts";

class FakeSocket extends EventEmitter {
  pings = 0;
  terminated = false;
  ping() {
    this.pings++;
  }
  terminate() {
    this.terminated = true;
  }
}

function setup() {
  const wss = Object.assign(new EventEmitter(), { clients: new Set<FakeSocket>() });
  const connect = () => {
    const ws = new FakeSocket();
    wss.clients.add(ws);
    wss.emit("connection", ws);
    return ws;
  };
  return { wss, connect };
}

test("a client that never answers is pinged once, then terminated", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { wss, connect } = setup();
  startHeartbeat(wss as never, 100);
  const ws = connect();
  t.mock.timers.tick(100);
  assert.equal(ws.pings, 1);
  assert.equal(ws.terminated, false);
  t.mock.timers.tick(100);
  assert.equal(ws.terminated, true);
});

test("a client that answers every ping stays connected", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { wss, connect } = setup();
  startHeartbeat(wss as never, 100);
  const ws = connect();
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(100);
    ws.emit("pong");
  }
  assert.equal(ws.pings, 4);
  assert.equal(ws.terminated, false);
});

test("closing the server stops the heartbeat", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { wss, connect } = setup();
  startHeartbeat(wss as never, 100);
  const ws = connect();
  wss.emit("close");
  t.mock.timers.tick(500);
  assert.equal(ws.pings, 0);
  assert.equal(ws.terminated, false);
});
