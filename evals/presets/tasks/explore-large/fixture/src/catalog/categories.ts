export const CATEGORIES = [
  { id: "kitchen", name: "Kitchen" },
  { id: "books", name: "Books" },
  { id: "home", name: "Home" },
] as const;

export function categoryName(id: string): string {
  return CATEGORIES.find((c) => c.id === id)?.name ?? id;
}
