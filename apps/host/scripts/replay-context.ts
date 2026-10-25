// Usage: pnpm --filter ./apps/host exec tsx scripts/replay-context.ts <session.jsonl> [--no-host] [--window=32768]
import { defaultHooks, formatStats, loadSession, replaySession } from "../src/context-replay.ts";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: replay-context.ts <session.jsonl> [--no-host] [--window=<tokens>]");
  process.exit(2);
}
const window = Number(args.find((a) => a.startsWith("--window="))?.slice(9)) || undefined;
const stats = replaySession(loadSession(file), defaultHooks({ host: !args.includes("--no-host"), window }));
console.log(formatStats(stats));
const t3 = stats.find((s) => s.turn === 3)?.tokensAfter;
if (t3) {
  const max = Math.max(...stats.filter((s) => s.turn >= 3).map((s) => s.tokensAfter / t3));
  console.log(`max tokensAfter / turn-3 tokensAfter: ${max.toFixed(2)}`);
}
