import type { Readable, Writable } from "node:stream";

export type CdpEvent = { method: string; params?: any; sessionId?: string };

/** The seam a CDP driver sits on: a WebSocket today, a Chrome pipe here. */
export interface CdpTransport {
  send(method: string, params?: object, sessionId?: string): Promise<any>;
  onEvent(handler: (event: CdpEvent) => void): void;
  onClose(handler: (error: Error) => void): void;
  close(): void;
}

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void };

/**
 * CDP over Chrome's `--remote-debugging-pipe`: JSON messages, each terminated by a NUL byte.
 * We write to fd3 (`out`) and read from fd4 (`input`).
 */
export class PipeTransport implements CdpTransport {
  private seq = 0;
  private buffer = "";
  private pending = new Map<number, Pending>();
  private eventHandlers: ((event: CdpEvent) => void)[] = [];
  private closeHandlers: ((error: Error) => void)[] = [];
  private closed: Error | undefined;

  constructor(private out: Writable, input: Readable) {
    input.setEncoding("utf8");
    input.on("data", (chunk: string) => this.onData(chunk));
    input.on("end", () => this.fail(new Error("Browser pipe closed")));
    input.on("close", () => this.fail(new Error("Browser pipe closed")));
    input.on("error", (e) => this.fail(e));
    out.on("error", (e) => this.fail(e));
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let at: number;
    while ((at = this.buffer.indexOf("\0")) >= 0) {
      const raw = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 1);
      if (!raw) continue;
      let msg: any;
      try {
        msg = JSON.parse(raw);
      } catch {
        continue;
      }
      this.onMessage(msg);
    }
  }

  private onMessage(msg: { id?: number; result?: any; error?: { message: string }; method?: string; params?: any; sessionId?: string }) {
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p?.reject(new Error(msg.error.message));
      else p?.resolve(msg.result);
      return;
    }
    if (msg.method) for (const h of this.eventHandlers) h({ method: msg.method, params: msg.params, sessionId: msg.sessionId });
  }

  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    if (this.closed) return Promise.reject(this.closed);
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const message = sessionId ? { id, method, params, sessionId } : { id, method, params };
      this.out.write(JSON.stringify(message) + "\0");
    });
  }

  onEvent(handler: (event: CdpEvent) => void) {
    this.eventHandlers.push(handler);
  }

  onClose(handler: (error: Error) => void) {
    if (this.closed) handler(this.closed);
    else this.closeHandlers.push(handler);
  }

  /** Fails everything in flight; safe to call more than once. */
  fail(error: Error) {
    if (this.closed) return;
    this.closed = error;
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
    for (const h of this.closeHandlers.splice(0)) h(error);
  }

  close() {
    this.fail(new Error("Browser pipe closed"));
  }
}
