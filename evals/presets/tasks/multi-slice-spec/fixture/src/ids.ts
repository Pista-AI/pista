/** Returns a function that hands out "<prefix>-1", "<prefix>-2", ... */
export function makeIdGenerator(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}
