import type { WebSocket, WebSocketServer } from "ws";

export const PING_INTERVAL_MS = 15_000;

/**
 * Protocol-level ping every interval; a client that has not answered since the previous ping is
 * terminated (sleep or a network blip leaves half-open sockets that never emit close). Browsers
 * answer protocol pings on their own. The timer is cleared when the server closes.
 */
export function startHeartbeat(wss: Pick<WebSocketServer, "clients" | "on">, intervalMs = PING_INTERVAL_MS): () => void {
  const alive = new WeakSet<WebSocket>();
  wss.on("connection", (ws: WebSocket) => {
    alive.add(ws);
    ws.on("pong", () => alive.add(ws));
  });
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, intervalMs);
  timer.unref();
  const stop = () => clearInterval(timer);
  wss.on("close", stop);
  return stop;
}
