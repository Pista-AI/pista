// Generates ./fixture (a shop backend of ~190 small TypeScript files). Output is committed; rerun with
// `node generate.mjs` from this folder only to change the fixture. Deterministic, node built-ins only.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "fixture");
rmSync(out, { recursive: true, force: true });
const put = (path, text) => {
  mkdirSync(dirname(join(out, path)), { recursive: true });
  writeFileSync(join(out, path), text);
};
const camel = (s) => s.replace(/-(\w)/g, (_, c) => c.toUpperCase());
const pascal = (s) => camel(s)[0].toUpperCase() + camel(s).slice(1);

put("package.json", JSON.stringify({ name: "shop", private: true, type: "module", scripts: { test: "node --test" } }) + "\n");
cpSync(join(here, "..", "explore-large", "fixture", "tsconfig.json"), join(out, "tsconfig.json"));
cpSync(join(here, "..", "explore-large", "fixture", "types"), join(out, "types"), { recursive: true });

// Hand-written core modules: the helpers the sub-changes build on.
const core = {
  "inventory/stock.ts": `export interface Stock {\n  onHand: number;\n  reserved: number;\n}\n\n/** Units that can still be promised to a customer; never negative. */\nexport function available(stock: Stock): number {\n  return Math.max(0, stock.onHand - stock.reserved);\n}\n\nexport function isLow(stock: Stock, threshold = 5): boolean {\n  return available(stock) <= threshold;\n}\n`,
  "orders/lines.ts": `export interface OrderLine {\n  sku: string;\n  qty: number;\n  unitCents: number;\n}\n\nexport function lineTotal(line: OrderLine): number {\n  return line.qty * line.unitCents;\n}\n\nexport function orderSubtotal(lines: OrderLine[]): number {\n  return lines.reduce((sum, line) => sum + lineTotal(line), 0);\n}\n`,
  "billing/numbers.ts": `/** Left-pads a non-negative integer with zeros to \`width\` digits. */\nexport function padNumber(n: number, width: number): string {\n  return String(n).padStart(width, "0");\n}\n\nexport function isPositiveInt(n: number): boolean {\n  return Number.isInteger(n) && n > 0;\n}\n`,
  "notifications/escape.ts": `const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };\n\nexport function escapeHtml(text: string): string {\n  return text.replace(/[&<>"']/g, (c) => ENTITIES[c]!);\n}\n`,
  "reports/aggregate.ts": `export function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {\n  const groups = new Map<string, T[]>();\n  for (const item of items) {\n    const k = key(item);\n    const list = groups.get(k);\n    if (list) list.push(item);\n    else groups.set(k, [item]);\n  }\n  return groups;\n}\n`,
  "reports/dates.ts": `/** The UTC calendar day (YYYY-MM-DD) of an ISO timestamp. */\nexport function dayOf(iso: string): string {\n  return new Date(iso).toISOString().slice(0, 10);\n}\n`,
};
for (const [path, text] of Object.entries(core)) put(`src/${path}`, text);
put(
  "test/core.test.ts",
  `import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { available, isLow } from "../src/inventory/stock.ts";\nimport { orderSubtotal } from "../src/orders/lines.ts";\nimport { padNumber } from "../src/billing/numbers.ts";\nimport { escapeHtml } from "../src/notifications/escape.ts";\nimport { groupBy } from "../src/reports/aggregate.ts";\nimport { dayOf } from "../src/reports/dates.ts";\n\ntest("core helpers", () => {\n  assert.equal(available({ onHand: 3, reserved: 5 }), 0);\n  assert.equal(isLow({ onHand: 10, reserved: 6 }), true);\n  assert.equal(orderSubtotal([{ sku: "a", qty: 2, unitCents: 150 }]), 300);\n  assert.equal(padNumber(42, 6), "000042");\n  assert.equal(escapeHtml("<b>&"), "&lt;b&gt;&amp;");\n  assert.equal(groupBy([1, 2, 3], (n) => (n % 2 ? "odd" : "even")).get("odd")!.length, 2);\n  assert.equal(dayOf("2026-03-04T23:30:00Z"), "2026-03-04");\n});\n`,
);

// Small single-purpose modules in five shapes, so every domain has dozens of files to read through.
const shapes = [
  (n) => ({ src: `/** ${n} codes are upper-case and prefixed. */\nexport function format${pascal(n)}(value: string): string {\n  return "${n.slice(0, 3).toUpperCase()}-" + value.trim().toUpperCase();\n}\n`, test: (m) => `assert.equal(${m}.format${pascal(n)}(" ab1 "), "${n.slice(0, 3).toUpperCase()}-AB1");` }),
  (n, i) => ({ src: `export function is${pascal(n)}Valid(n: number): boolean {\n  return Number.isInteger(n) && n >= ${i % 4} && n <= ${100 + i};\n}\n`, test: (m) => `assert.equal(${m}.is${pascal(n)}Valid(${100 + i}), true);\n  assert.equal(${m}.is${pascal(n)}Valid(${101 + i}), false);` }),
  (n, i) => ({ src: `const TABLE: Record<string, number> = { a: ${i + 1}, b: ${i + 2}, c: ${i + 3} };\n\nexport function ${camel(n)}Weight(key: string): number {\n  return TABLE[key] ?? 0;\n}\n`, test: (m) => `assert.equal(${m}.${camel(n)}Weight("b"), ${i + 2});\n  assert.equal(${m}.${camel(n)}Weight("z"), 0);` }),
  (n, i) => ({ src: `export function ${camel(n)}Scale(value: number, factor = ${2 + (i % 5)}): number {\n  return Math.round(value * factor);\n}\n`, test: (m) => `assert.equal(${m}.${camel(n)}Scale(10), ${10 * (2 + (i % 5))});` }),
  (n) => ({ src: `export function ${camel(n)}Label(count: number): string {\n  return count === 1 ? "1 ${n}" : \`\${count} ${n}s\`;\n}\n`, test: (m) => `assert.equal(${m}.${camel(n)}Label(1), "1 ${n}");\n  assert.equal(${m}.${camel(n)}Label(3), "3 ${n}s");` }),
];
const words = {
  inventory: "warehouse bin shelf pallet aisle zone dock lot batch serial barcode label carton crate tote rack bay slot tag scan count audit cycle putaway pick pack ship restock damage expiry recall transfer".split(" "),
  orders: "cart checkout coupon voucher gift wishlist address carrier parcel tracking delivery pickup locker invoice receipt refund exchange backorder preorder bundle subscription tax duty tip fee surcharge rounding currency channel source campaign referral".split(" "),
  billing: "ledger account balance payout charge capture authorize dispute chargeback settlement fee interest credit debit statement reminder dunning writeoff proration plan tier trial renewal cancel pause reactivate mandate token vault risk fraud".split(" "),
  notifications: "email sms push digest banner toast inbox webhook channel topic preference quiet window snooze retry bounce unsubscribe locale subject footer header signature greeting reminder alert escalation roster pager queue batch throttle dedupe archive".split(" "),
  reports: "daily weekly monthly quarterly yearly cohort funnel churn retention margin revenue cost basket average median percentile trend forecast anomaly segment region category brand supplier staff shift coverage backlog aging turnover extract snapshot".split(" "),
};
for (const [domain, names] of Object.entries(words)) {
  const tests = [];
  names.forEach((name, i) => {
    const shape = shapes[(i + domain.length) % shapes.length](name, i);
    put(`src/${domain}/${name}.ts`, shape.src);
    tests.push({ name, body: shape.test(camel(name)) });
  });
  const imports = tests.map((t) => `import * as ${camel(t.name)} from "../src/${domain}/${t.name}.ts";`).join("\n");
  put(`test/${domain}-modules.test.ts`, `import assert from "node:assert/strict";\nimport { test } from "node:test";\n${imports}\n\n${tests.map((t) => `test("${domain}/${t.name}", () => {\n  ${t.body}\n});`).join("\n\n")}\n`);
}
