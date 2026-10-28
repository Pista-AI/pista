export type Zone = "domestic" | "nordic" | "europe";

export const SHIPPING_CENTS: Record<Zone, number> = { domestic: 4900, nordic: 9900, europe: 14900 };

/** Calendar days a parcel travels after it left the warehouse. */
export const TRANSIT_DAYS: Record<Zone, number> = { domestic: 2, nordic: 4, europe: 6 };
