import type { HostEvent, HostFrame, MethodName, Params, Result } from "@pista/protocol";
import { DEFAULT_HOST_PORT } from "@pista/protocol";

type Listener = (event: HostEvent) => void;
type StatusListener = (connected: boolean) => void;

/**
 * Where the agent host lives. Desktop shells inject `window.pistaDesktop.hostUrl`;
 * in the browser we use the page origin (Vite proxies /ws in dev, the host serves
 * the UI in production).
 */
function hostSocketUrl(): string {
  const injected = window.pistaDesktop?.hostUrl;
  if (injected) return injected.replace(/^http/, "ws") + "/ws";
  const { protocol, host } = window.location;
  if (protocol === "http:" || protocol === "https:") return `${protocol === "https:" ? "wss" : "ws"}://${host}/ws`;
  return `ws://127.0.0.1:${DEFAULT_HOST_PORT}/ws`;
}

class HostClient {
  private ws?: WebSocket;
  private seq = 0;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private queue: string[] = [];
  private retry = 0;
  connected = false;

  connect(): void {
    const ws = new WebSocket(hostSocketUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setConnected(true);
      for (const frame of this.queue.splice(0)) ws.send(frame);
    };
    ws.onmessage = (msg) => {
      const frame = JSON.parse(msg.data) as HostFrame;
      if (frame.kind === "evt") {
        for (const l of this.listeners) l(frame.event);
        return;
      }
      const p = this.pending.get(frame.id);
      if (!p) return;
      this.pending.delete(frame.id);
      if (frame.ok) p.resolve(frame.result);
      else p.reject(new Error(frame.error));
    };
    ws.onclose = () => {
      this.setConnected(false);
      for (const p of this.pending.values()) p.reject(new Error("Disconnected from agent host"));
      this.pending.clear();
      const delay = Math.min(5000, 300 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  call<M extends MethodName>(method: M, params: Params<M>): Promise<Result<M>> {
    const id = String(++this.seq);
    const frame = JSON.stringify({ kind: "req", id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(frame);
      else this.queue.push(frame);
    });
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private setConnected(value: boolean) {
    this.connected = value;
    for (const l of this.statusListeners) l(value);
  }
}

export const host = new HostClient();
