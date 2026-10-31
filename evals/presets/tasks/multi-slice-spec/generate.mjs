// Generates ./fixture (a shop backend of about 45 files with an orders CLI to imitate). Output is committed; rerun with
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

const core = {
  "errors.ts": `/** An expected failure (bad input from the caller, a rule of the shop). \`code\` is stable; \`message\` is for people. */\nexport class DomainError extends Error {\n  readonly code: string;\n  constructor(code: string, message: string) {\n    super(message);\n    this.name = "DomainError";\n    this.code = code;\n  }\n}\n`,
  "ids.ts": `/** Returns a function that hands out "<prefix>-1", "<prefix>-2", ... */\nexport function makeIdGenerator(prefix: string): () => string {\n  let n = 0;\n  return () => \`\${prefix}-\${++n}\`;\n}\n`,
  "money.ts": `/** 3998 -> "39.98" */\nexport function formatCents(cents: number): string {\n  const sign = cents < 0 ? "-" : "";\n  const abs = Math.abs(cents);\n  return \`\${sign}\${Math.floor(abs / 100)}.\${String(abs % 100).padStart(2, "0")}\`;\n}\n`,
  "orders/lines.ts": `export interface OrderLine {\n  sku: string;\n  qty: number;\n  unitCents: number;\n}\n\nexport function lineTotal(line: OrderLine): number {\n  return line.qty * line.unitCents;\n}\n`,
  "orders/store.ts": `import { DomainError } from "../errors.ts";\nimport type { OrderLine } from "./lines.ts";\n\nexport interface Order {\n  id: string;\n  customerId: string;\n  lines: OrderLine[];\n  status: "open" | "shipped" | "cancelled";\n}\n\nexport class OrderStore {\n  private readonly orders = new Map<string, Order>();\n\n  add(order: Order): void {\n    if (this.orders.has(order.id)) throw new DomainError("order-exists", \`order already exists: \${order.id}\`);\n    this.orders.set(order.id, order);\n  }\n\n  find(id: string): Order | undefined {\n    return this.orders.get(id);\n  }\n\n  all(): Order[] {\n    return [...this.orders.values()];\n  }\n}\n`,
  // The CLI the new returns CLI should imitate: exit 0 ok, 1 domain error, 2 usage error; output goes through \`out\`.
  "cli/orders.ts": `import { DomainError } from "../errors.ts";\nimport { formatCents } from "../money.ts";\nimport { lineTotal } from "../orders/lines.ts";\nimport type { OrderStore } from "../orders/store.ts";\n\nconst USAGE = "usage: orders <show|list> [id]";\n\n/** Exit codes: 0 ok, 1 domain error (printed as "error: <message>"), 2 usage error (printed as the usage line). */\nexport function runOrdersCli(argv: string[], store: OrderStore, out: (line: string) => void): number {\n  const [command, ...args] = argv;\n  try {\n    if (command === "list" && args.length === 0) {\n      const orders = store.all();\n      if (orders.length === 0) out("no orders");\n      for (const o of orders) out(\`\${o.id} \${o.status} \${o.customerId}\`);\n      return 0;\n    }\n    if (command === "show" && args.length === 1) {\n      const order = store.find(args[0]!);\n      if (!order) throw new DomainError("order-not-found", \`order not found: \${args[0]}\`);\n      out(\`\${order.id} \${order.status}\`);\n      for (const l of order.lines) out(\`  \${l.qty} x \${l.sku} = \${formatCents(lineTotal(l))}\`);\n      return 0;\n    }\n    out(USAGE);\n    return 2;\n  } catch (error) {\n    if (!(error instanceof DomainError)) throw error;\n    out(\`error: \${error.message}\`);\n    return 1;\n  }\n}\n`,
};
for (const [path, text] of Object.entries(core)) put(`src/${path}`, text);
put(
  "test/orders-cli.test.ts",
  `import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { runOrdersCli } from "../src/cli/orders.ts";\nimport { OrderStore } from "../src/orders/store.ts";\n\ntest("orders cli", () => {\n  const store = new OrderStore();\n  store.add({ id: "o-1", customerId: "c-1", status: "open", lines: [{ sku: "mug-01", qty: 2, unitCents: 1999 }] });\n  const lines: string[] = [];\n  assert.equal(runOrdersCli(["show", "o-1"], store, (l) => lines.push(l)), 0);\n  assert.deepEqual(lines, ["o-1 open", "  2 x mug-01 = 39.98"]);\n  lines.length = 0;\n  assert.equal(runOrdersCli(["show", "o-9"], store, (l) => lines.push(l)), 1);\n  assert.deepEqual(lines, ["error: order not found: o-9"]);\n  lines.length = 0;\n  assert.equal(runOrdersCli(["bogus"], store, (l) => lines.push(l)), 2);\n  assert.deepEqual(lines, ["usage: orders <show|list> [id]"]);\n});\n`,
);

const shapes = [
  (n) => ({ src: `/** ${n} codes are upper-case and prefixed. */\nexport function format${pascal(n)}(value: string): string {\n  return "${n.slice(0, 3).toUpperCase()}-" + value.trim().toUpperCase();\n}\n`, test: (m) => `assert.equal(${m}.format${pascal(n)}(" ab1 "), "${n.slice(0, 3).toUpperCase()}-AB1");` }),
  (n, i) => ({ src: `export function is${pascal(n)}Valid(n: number): boolean {\n  return Number.isInteger(n) && n >= ${i % 4} && n <= ${100 + i};\n}\n`, test: (m) => `assert.equal(${m}.is${pascal(n)}Valid(${100 + i}), true);\n  assert.equal(${m}.is${pascal(n)}Valid(${101 + i}), false);` }),
  (n, i) => ({ src: `const TABLE: Record<string, number> = { a: ${i + 1}, b: ${i + 2}, c: ${i + 3} };\n\nexport function ${camel(n)}Weight(key: string): number {\n  return TABLE[key] ?? 0;\n}\n`, test: (m) => `assert.equal(${m}.${camel(n)}Weight("b"), ${i + 2});\n  assert.equal(${m}.${camel(n)}Weight("z"), 0);` }),
  (n, i) => ({ src: `export function ${camel(n)}Scale(value: number, factor = ${2 + (i % 5)}): number {\n  return Math.round(value * factor);\n}\n`, test: (m) => `assert.equal(${m}.${camel(n)}Scale(10), ${10 * (2 + (i % 5))});` }),
  (n) => ({ src: `export function ${camel(n)}Label(count: number): string {\n  return count === 1 ? "1 ${n}" : \`\${count} ${n}s\`;\n}\n`, test: (m) => `assert.equal(${m}.${camel(n)}Label(1), "1 ${n}");\n  assert.equal(${m}.${camel(n)}Label(3), "3 ${n}s");` }),
];
const words = {
  catalog: "category brand variant option size color material season collection badge rating review image gallery".split(" "),
  customers: "profile segment tier loyalty consent newsletter locale timezone avatar nickname referral birthday note".split(" "),
  payments: "method gateway token wallet voucher capture settle payout fee currency mandate receipt terminal".split(" "),
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
