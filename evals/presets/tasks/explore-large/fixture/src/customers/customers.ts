import type { Address } from "./addresses.ts";

export interface Customer {
  id: string;
  name: string;
  address: Address;
}

export const CUSTOMERS: Customer[] = [
  { id: "c-1", name: "Astrid", address: { street: "Storgatan 1", city: "Malmö", country: "SE" } },
  { id: "c-2", name: "Ola", address: { street: "Karl Johans gate 5", city: "Oslo", country: "NO" } },
  { id: "c-3", name: "Mette", address: { street: "Hauptstrasse 9", city: "Hamburg", country: "DE" } },
];

export function findCustomer(id: string): Customer {
  const customer = CUSTOMERS.find((c) => c.id === id);
  if (!customer) throw new Error(`unknown customer ${id}`);
  return customer;
}
