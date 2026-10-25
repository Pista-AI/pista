import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { HostEvent, HostFrame } from "@pista/protocol";

interface Pending<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface ClientInfo {
  /** Desktop window with a real (native) browser view. */
  nativeBrowser: boolean;
  lastActive: number;
}

/**
 * Fan-out to connected UI windows, plus host → UI round trips (browser actions,
 * tool approvals, login prompts) that resolve when any window answers.
 */
export class Hub {
  private clients = new Map<WebSocket, ClientInfo>();
  private pending = new Map<string, Pending<unknown>>();

  add(ws: WebSocket): void {
    this.clients.set(ws, { nativeBrowser: false, lastActive: Date.now() });
    ws.on("close", () => this.clients.delete(ws));
  }

  describe(ws: WebSocket, client: { nativeBrowser?: boolean } | undefined): void {
    const info = this.clients.get(ws);
    if (info) info.nativeBrowser = Boolean(client?.nativeBrowser);
  }

  touch(ws: WebSocket): void {
    const info = this.clients.get(ws);
    if (info) info.lastActive = Date.now();
  }

  /**
   * Browser actions must run in exactly one window: a desktop window with a native browser
   * when one is connected, otherwise the most recently active window.
   */
  private browserTarget(): WebSocket | undefined {
    const open = [...this.clients].filter(([ws]) => ws.readyState === ws.OPEN);
    const native = open.filter(([, info]) => info.nativeBrowser);
    const pool = native.length > 0 ? native : open;
    return pool.sort(([, a], [, b]) => b.lastActive - a.lastActive)[0]?.[0];
  }

  get hasClients(): boolean {
    return this.clients.size > 0;
  }

  emit(event: HostEvent): void {
    const frame = JSON.stringify({ kind: "evt", event } satisfies HostFrame);
    for (const ws of this.clients.keys()) if (ws.readyState === ws.OPEN) ws.send(frame);
  }

  /** Emit an event that expects an answer routed back through `settle()`. */
  ask<T>(build: (id: string) => HostEvent, timeoutMs: number, signal?: AbortSignal, target?: "browser"): Promise<T> {
    if (!this.hasClients) return Promise.reject(new Error("No Pista window is connected"));
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Timed out waiting for the client"));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      signal?.addEventListener("abort", () => this.settle(id, new Error("Aborted")), { once: true });
      const event = build(id);
      const ws = target === "browser" ? this.browserTarget() : undefined;
      if (ws) ws.send(JSON.stringify({ kind: "evt", event } satisfies HostFrame));
      else this.emit(event);
    });
  }

  settle(id: string, outcome: unknown): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    if (outcome instanceof Error) entry.reject(outcome);
    else entry.resolve(outcome);
  }
}
