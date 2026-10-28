export type Zone = "domestic" | "nordic" | "europe" | "world";

export const SHIPPING_CENTS: Record<Zone, number> = {
  domestic: 4900,
  nordic: 9900,
  europe: 14900,
  world: 24900,
};
