import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Test support: a stand-in for the llama.cpp router's REST API, with one model and scriptable behaviour. */
export const ROUTER_MODEL_ID = "ggml-org/stories15M_MOE:Q8_0";

export interface FakeRouterState {
  /** Router status of the one model: unloaded | loading | loaded | downloading | anything else maps to error. */
  status: string;
  requests: { method: string; path: string; search: string; body: string }[];
  /** Raw SSE chunks written when a client connects to /models/sse. */
  sse: string[];
  /** What the model becomes after POST /models/load: "loaded" (after a short or long delay), "failed", or "stuck" (stays loading). */
  loadResult: "loaded" | "failed" | "stuck";
  loadDelay: boolean;
  /** POST /models/unload leaves the model loaded. */
  stuckUnload: boolean;
  /** POST /models (download) finds the model already cached instead of starting a download. */
  cached: boolean;
  /** The model is listed by GET /models. False until POST /models (a download of a model the router has never seen). */
  known: boolean;
  /** Status the model has right after POST /models: "downloading" by default; "unloaded" mimics the router listing a new download as idle. */
  statusAfterPost: string;
}

export class FakeRouter {
  state: FakeRouterState = { status: "unloaded", requests: [], sse: [], loadResult: "loaded", loadDelay: false, stuckUnload: false, cached: false, known: true, statusAfterPost: "downloading" };
  base = "";
  home = "";
  private server: Server | undefined;

  reset() {
    Object.assign(this.state, { status: "unloaded", requests: [], sse: [], loadResult: "loaded", loadDelay: false, stuckUnload: false, cached: false, known: true, statusAfterPost: "downloading" });
  }

  requestsTo(path: string, method?: string) {
    return this.state.requests.filter((r) => r.path === path && (!method || r.method === method));
  }

  async start() {
    this.home = mkdtempSync(join(tmpdir(), "pista-fake-router-"));
    writeFileSync(join(this.home, "models.ini"), "version = 1\n[*]\nc = 16384\nnp = 1\n");
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.base = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
  }

  stop() {
    this.server?.closeAllConnections();
    this.server?.close();
    rmSync(this.home, { recursive: true, force: true });
  }

  private handle(req: IncomingMessage, res: ServerResponse) {
    const send = (body: unknown, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    const url = new URL(req.url ?? "/", "http://x");
    const s = this.state;
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      s.requests.push({ method: req.method ?? "GET", path: url.pathname, search: url.search, body });
      if (url.pathname === "/health") return send({ status: "ok" });
      if (url.pathname === "/models" && req.method === "GET") {
        return send({
          data: !s.known ? [] : [{ id: ROUTER_MODEL_ID, status: { value: s.status }, context_length: 256, ...(s.status === "loaded" ? { meta: { n_ctx: 256, size: 38662272 } } : {}) }],
        });
      }
      if (url.pathname === "/props") {
        // The real router loads the model for a plain /props?model= request; the client must opt out.
        if (url.searchParams.get("autoload") !== "false") return send({ error: { message: "would autoload" } }, 500);
        return send({ chat_template: "{% if enable_thinking %}x{% endif %}" });
      }
      if (url.pathname === "/models/load") {
        if (JSON.parse(body).model === "missing") return send({ error: { message: "model not found" } }, 400);
        s.status = "loading";
        if (s.loadResult !== "stuck") setTimeout(() => (s.status = s.loadResult === "failed" ? "failed" : "loaded"), s.loadDelay ? 400 : 20);
        return send({ success: true });
      }
      if (url.pathname === "/models/unload") {
        if (!s.stuckUnload) s.status = "unloaded";
        return send({ success: true });
      }
      if (url.pathname === "/models" && req.method === "POST") {
        if (!/^[\w-]+\/[\w.-]+:\w+$/.test(JSON.parse(body).model)) return send({ error: { message: "invalid HF repo format" } }, 400);
        s.known = true;
        if (!s.cached) s.status = s.statusAfterPost;
        return send({ success: true });
      }
      if (url.pathname === "/models/sse") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        let i = 0;
        const next = () => {
          if (i >= s.sse.length) return res.end();
          res.write(s.sse[i++]);
          setTimeout(next, 5);
        };
        return next();
      }
      send({ error: { message: "nope" } }, 404);
    });
  }
}
