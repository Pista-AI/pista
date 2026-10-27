export interface Customer {
  id: string;
  name: string;
  country: string;
}

export const CUSTOMERS: Customer[] = [
  { id: "c-1", name: "Astrid", country: "SE" },
  { id: "c-2", name: "Ola", country: "NO" },
  { id: "c-3", name: "Mette", country: "DK" },
];

export function findCustomer(id: string): Customer {
  const customer = CUSTOMERS.find((c) => c.id === id);
  if (!customer) throw new Error(`unknown customer ${id}`);
  return customer;
}
