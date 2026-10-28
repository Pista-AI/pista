export interface Customer {
  id: string;
  name: string;
  country: string; // as entered in the CRM: a code or a country name
}

export const CUSTOMERS: Customer[] = [
  { id: "c-1", name: "Astrid Berg", country: "SE" },
  { id: "c-2", name: "Fjord AS", country: "NO" },
  { id: "c-3", name: "Nordlys Kaffe", country: "Norway" },
  { id: "c-4", name: "Hanse GmbH", country: "Deutschland" },
  { id: "c-5", name: "Kari Nordmann", country: "Norge" },
  { id: "c-6", name: "Mette Holm", country: "dk" },
];

export function findCustomer(id: string): Customer {
  const customer = CUSTOMERS.find((c) => c.id === id);
  if (!customer) throw new Error(`unknown customer ${id}`);
  return customer;
}
