import { DomainError } from "../errors.ts";
import { formatCents } from "../money.ts";
import type { ReturnService } from "../returns/service.ts";
import { isReturnStatus } from "../returns/types.ts";

const USAGE = "usage: returns <request|approve|reject|receive|refund|list> ...";

export function runReturnsCli(argv: string[], service: ReturnService, out: (line: string) => void): number {
  const [command, ...args] = argv;
  try {
    if (command === "request" && args.length >= 4) {
      const qty = Number(args[2]);
      if (Number.isNaN(qty)) return usage(out);
      const r = service.request(args[0]!, args[1]!, qty, args.slice(3).join(" "));
      out(`requested ${r.id}: ${r.qty} x ${r.sku} (order ${r.orderId})`);
      return 0;
    }
    if (command === "approve" && args.length === 1) return say(out, `${service.approve(args[0]!).id} approved`);
    if (command === "receive" && args.length === 1) return say(out, `${service.receive(args[0]!).id} received`);
    if (command === "reject" && args.length >= 2) {
      const r = service.reject(args[0]!, args.slice(1).join(" "));
      return say(out, `${r.id} rejected: ${r.note}`);
    }
    if (command === "refund" && args.length === 1) {
      const r = service.refund(args[0]!);
      return say(out, `${r.id} refunded ${formatCents(r.refundCents!)}`);
    }
    if (command === "list" && args.length <= 1) {
      const status = args[0];
      if (status !== undefined && !isReturnStatus(status)) return usage(out);
      const rows = service.list(status);
      if (rows.length === 0) out("no returns");
      for (const r of rows) out(`${r.id} ${r.status} ${r.orderId} ${r.sku} x${r.qty}`);
      return 0;
    }
    return usage(out);
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    out(`error: ${error.message}`);
    return 1;
  }
}

function say(out: (line: string) => void, line: string): number {
  out(line);
  return 0;
}

function usage(out: (line: string) => void): number {
  out(USAGE);
  return 2;
}
