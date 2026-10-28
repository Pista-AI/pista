// Minimal typings for the node built-ins this fixture's tests use (no @types/node needed).
declare module "node:test" {
  export function test(name: string, fn: () => void | Promise<void>): void;
}

declare module "node:assert/strict" {
  interface Assert {
    (value: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    throws(fn: () => unknown, expected?: unknown, message?: string): void;
    match(value: string, pattern: RegExp, message?: string): void;
    doesNotMatch(value: string, pattern: RegExp, message?: string): void;
  }
  const assert: Assert;
  export default assert;
}
