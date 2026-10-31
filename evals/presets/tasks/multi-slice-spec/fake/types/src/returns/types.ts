export type ReturnStatus = "requested" | "approved" | "rejected" | "received" | "refunded";

export const RETURN_STATUSES: readonly ReturnStatus[] = ["requested", "approved", "rejected", "received", "refunded"];

export interface ReturnRequest {
  id: string;
  orderId: string;
  sku: string;
  qty: number;
  reason: string;
  status: ReturnStatus;
  note?: string;
  refundCents?: number;
}

export function isReturnStatus(value: unknown): value is ReturnStatus {
  return typeof value === "string" && (RETURN_STATUSES as readonly string[]).includes(value);
}

const NEXT: Record<ReturnStatus, ReturnStatus[]> = { requested: ["approved", "rejected"], approved: ["received"], rejected: [], received: ["refunded"], refunded: [] };

export function canTransition(from: ReturnStatus, to: ReturnStatus): boolean {
  return NEXT[from].includes(to);
}
