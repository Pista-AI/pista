import { DomainError } from "../errors.ts";
import { makeIdGenerator } from "../ids.ts";
import type { OrderStore } from "../orders/store.ts";
import { canTransition, type ReturnRequest, type ReturnStatus } from "./types.ts";

export class ReturnService {
  private readonly returns: ReturnRequest[] = [];

  private readonly orders: OrderStore;
  private readonly newId: () => string;

  constructor(orders: OrderStore, newId: () => string = makeIdGenerator("ret")) {
    this.orders = orders;
    this.newId = newId;
  }

  request(orderId: string, sku: string, qty: number, reason: string): ReturnRequest {
    const text = reason.trim();
    if (!text) throw new DomainError("reason-required", "a reason is required");
    const order = this.orders.find(orderId);
    if (!order) throw new DomainError("order-not-found", `order not found: ${orderId}`);
    const ordered = order.lines.filter((l) => l.sku === sku).reduce((sum, l) => sum + l.qty, 0);
    if (ordered === 0) throw new DomainError("sku-not-in-order", `${sku} is not in order ${orderId}`);
    if (!Number.isInteger(qty) || qty <= 0) throw new DomainError("invalid-qty", "quantity must be a positive integer");
    const taken = this.returns.filter((r) => r.orderId === orderId && r.sku === sku && r.status !== "rejected").reduce((sum, r) => sum + r.qty, 0);
    const left = ordered - taken;
    if (qty > left) throw new DomainError("qty-exceeds-order", `cannot return ${qty} of ${sku}: ${left} left to return`);
    const created: ReturnRequest = { id: this.newId(), orderId, sku, qty, reason: text, status: "requested" };
    this.returns.push(created);
    return created;
  }

  approve(id: string): ReturnRequest {
    return this.move(id, "approved");
  }

  reject(id: string, note: string): ReturnRequest {
    if (!note.trim()) throw new DomainError("note-required", "a note is required");
    const r = this.move(id, "rejected");
    r.note = note.trim();
    return r;
  }

  receive(id: string): ReturnRequest {
    return this.move(id, "received");
  }

  refund(id: string): ReturnRequest {
    const r = this.move(id, "refunded");
    const line = this.orders.find(r.orderId)!.lines.find((l) => l.sku === r.sku)!;
    r.refundCents = r.qty * line.unitCents;
    return r;
  }

  get(id: string): ReturnRequest {
    const r = this.returns.find((x) => x.id === id);
    if (!r) throw new DomainError("return-not-found", `return not found: ${id}`);
    return r;
  }

  list(status?: ReturnStatus): ReturnRequest[] {
    return this.returns.filter((r) => status === undefined || r.status === status);
  }

  private move(id: string, to: ReturnStatus): ReturnRequest {
    const r = this.get(id);
    if (!canTransition(r.status, to)) throw new DomainError("bad-transition", `cannot go from ${r.status} to ${to}`);
    r.status = to;
    return r;
  }
}
