import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchJson, HttpError } from "./http.ts";

const answer = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch;

test("fetchJson parses JSON and reads an empty body as {}", async () => {
  assert.deepEqual(await fetchJson("http://x/", { timeoutMs: 1000, fetch: answer(200, '{"a":1}') }), { a: 1 });
  assert.deepEqual(await fetchJson("http://x/", { timeoutMs: 1000, fetch: answer(200, "") }), {});
});

test("fetchJson sends a JSON body as POST and passes headers through", async () => {
  let seen: RequestInit | undefined;
  const http = (async (_url: string, init?: RequestInit) => ((seen = init), new Response("{}"))) as unknown as typeof fetch;
  await fetchJson("http://x/", { body: { m: 1 }, headers: { authorization: "Bearer t" }, timeoutMs: 1000, fetch: http });
  assert.equal(seen?.method, "POST");
  assert.equal(seen?.body, '{"m":1}');
  assert.deepEqual(seen?.headers, { "content-type": "application/json", authorization: "Bearer t" });
});

test("fetchJson throws HttpError with the status and the server's message", async () => {
  await assert.rejects(fetchJson("http://x/", { timeoutMs: 1000, fetch: answer(404, "") }), (e: HttpError) => e.status === 404 && e.message === "HTTP 404");
  await assert.rejects(fetchJson("http://x/", { timeoutMs: 1000, fetch: answer(400, '{"error":{"message":"bad model"}}') }), /HTTP 400: bad model/);
  await assert.rejects(fetchJson("http://x/", { timeoutMs: 1000, fetch: answer(500, "boom") }), (e: HttpError) => e.detail === "boom");
});

test("fetchJson aborts when the timeout fires", async () => {
  const hang = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as unknown as typeof fetch;
  // AbortSignal.timeout's timer is unref'd and the fake fetch holds no socket, so without this the event loop
  // can drain before the timeout fires and the runner cancels the test (seen on CI). Real fetches keep it alive.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(fetchJson("http://x/", { timeoutMs: 20, fetch: hang }), (e: Error) => e.name === "TimeoutError" || e.name === "AbortError");
  } finally {
    clearInterval(keepAlive);
  }
});

test("fetchJson rejects a non-empty, non-JSON 2xx body", async () => {
  await assert.rejects(fetchJson("http://x/", { timeoutMs: 1000, fetch: answer(200, "<html>") }), SyntaxError);
});
