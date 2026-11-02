/** One live-view frame of the agent's tab. `data` is a base64 JPEG; width and height are CSS pixels of the page. */
export interface ScreencastFrame {
  data: string;
  width: number;
  height: number;
  url: string;
  title: string;
}

/** At most one delivered frame per interval (about 8 fps); the browser is acked for every frame regardless, so it never stalls. */
export const MIN_FRAME_INTERVAL_MS = 125;

/**
 * Fans frames out to subscribers with a rate limit. Frames that arrive too early are dropped, never queued,
 * so a slow consumer can only see fewer frames. `start` runs when the first subscriber arrives, `stop` when the last leaves.
 */
export class ScreencastFeed {
  private subs = new Set<(frame: ScreencastFrame) => void>();
  private last = -Infinity;

  constructor(
    private hooks: { start(): void; stop(): void },
    private now: () => number = Date.now,
  ) {}

  get count() {
    return this.subs.size;
  }

  subscribe(cb: (frame: ScreencastFrame) => void): () => void {
    const first = this.subs.size === 0;
    this.subs.add(cb);
    if (first) this.hooks.start();
    return () => {
      if (!this.subs.delete(cb)) return;
      if (this.subs.size === 0) this.hooks.stop();
    };
  }

  /** Returns whether the frame was delivered (false: dropped by the rate limit or nobody listens). */
  push(frame: ScreencastFrame): boolean {
    if (this.subs.size === 0) return false;
    const t = this.now();
    if (t - this.last < MIN_FRAME_INTERVAL_MS) return false;
    this.last = t;
    for (const cb of this.subs) cb(frame);
    return true;
  }
}
