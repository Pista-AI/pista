import assert from "node:assert/strict";
import { existsSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxModels, liveOf, makeManager, setupHome } from "./test-helpers.ts";

const { projectDir, agentDir } = setupHome("retention");
const sessionsDir = join(agentDir, "sessions");
const { models } = await fauxModels();
type Live = { session: { sessionManager: { appendMessage(m: unknown): void } } };
const DAY = 86_400_000;

/** A saved thread whose last activity is `days` back (message time and file mtime). */
async function savedThread(days: number) {
  const first = await makeManager({ projectDir, models });
  const { summary } = await first.manager.create(first.project.id);
  liveOf<Live>(first.manager).get(summary.id)!.session.sessionManager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() - days * DAY });
  const file = (await first.manager.list()).find((t) => t.id === summary.id)?.sessionFile;
  assert.ok(file, "session file is listed");
  const when = new Date(Date.now() - days * DAY);
  utimesSync(file, when, when);
  return { id: summary.id, file };
}

test("purgeThreads deletes old idle threads and keeps new and open ones", async () => {
  const old = await savedThread(60);
  const fresh = await savedThread(1);
  const open = await savedThread(60);
  const { manager, hub } = await makeManager({ models, dispose: false });
  const removed: string[] = [];
  const emit = hub.emit.bind(hub);
  hub.emit = (e) => (e.type === "thread.removed" && removed.push(e.threadId), emit(e));
  await manager.list();
  await manager.open(open.id); // an open (live) thread is kept even when old
  const stats = { threads: 0, skipped: 0 };
  await manager.purgeThreads(Date.now() - 30 * DAY, sessionsDir, stats);
  assert.equal(stats.threads, 1);
  assert.equal(stats.skipped, 0);
  assert.deepEqual(removed, [old.id]);
  assert.ok(!existsSync(old.file));
  assert.ok(existsSync(fresh.file));
  assert.ok(existsSync(open.file));
  assert.ok(!(await manager.list()).some((t) => t.id === old.id));
  manager.dispose();
});

test("a thread the user opens while the purge refreshes the index is kept", async () => {
  const racing = await savedThread(60);
  const { manager } = await makeManager({ models, dispose: false });
  await manager.list();
  const list = manager.list.bind(manager);
  let opened = false;
  manager.list = async () => {
    const result = await list();
    if (!opened) {
      opened = true;
      await manager.open(racing.id); // the user clicks the thread right after the refresh
    }
    return result;
  };
  const stats = { threads: 0, skipped: 0 };
  await manager.purgeThreads(Date.now() - 30 * DAY, sessionsDir, stats);
  assert.ok(existsSync(racing.file)); // other old threads from earlier tests may be purged; the racing one must not
  assert.ok(liveOf(manager).has(racing.id));
  manager.dispose();
});

test("session files outside the sessions dir are not deleted, and are counted as skipped", async () => {
  const old = await savedThread(60);
  const { manager } = await makeManager({ models, dispose: false });
  const stats = { threads: 0, skipped: 0 };
  await manager.purgeThreads(Date.now() - 30 * DAY, join(agentDir, "elsewhere"), stats);
  assert.ok(stats.skipped >= 1);
  assert.ok(existsSync(old.file));
  manager.dispose();
});
