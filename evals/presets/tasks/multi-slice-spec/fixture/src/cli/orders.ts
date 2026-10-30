import { DomainError } from "../errors.ts";
import { formatCents } from "../money.ts";
import { lineTotal } from "../orders/lines.ts";
import type { OrderStore } from "../orders/store.ts";

const USAGE = "usage: orders <show|list> [id]";

/** Exit codes: 0 ok, 1 domain error (printed as "error: <message>"), 2 usage error (printed as the usage line). */
export function runOrdersCli(argv: string[], store: OrderStore, out: (line: string) => void): number {
  const [command, ...args] = argv;
  try {
    if (command === "list" && args.length === 0) {
      const orders = store.all();
      if (orders.length === 0) out("no orders");
      for (const o of orders) out(`${o.id} ${o.status} ${o.customerId}`);
      return 0;
    }
    if (command === "show" && args.length === 1) {
      const order = store.find(args[0]!);
      if (!order) throw new DomainError("order-not-found", `order not found: ${args[0]}`);
      out(`${order.id} ${order.status}`);
      for (const l of order.lines) out(`  ${l.qty} x ${l.sku} = ${formatCents(lineTotal(l))}`);
      return 0;
    }
    out(USAGE);
    return 2;
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    out(`error: ${error.message}`);
    return 1;
  }
}
