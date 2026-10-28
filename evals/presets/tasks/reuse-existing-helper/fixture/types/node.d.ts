// Minimal typings for the node built-ins fixtures and tests use (no @types/node needed). Deliberately loose.
interface NodeTestContext {
  test: NodeTestFn;
  diagnostic(message: string): void;
  skip(message?: string): void;
}
type NodeTestBody = (t: NodeTestContext) => void | Promise<void>;
interface NodeTestFn {
  (name: string, fn?: NodeTestBody): Promise<void>;
  (name: string, options: object, fn?: NodeTestBody): Promise<void>;
}
interface NodeAssert {
  (value: unknown, message?: string): void;
  ok(value: unknown, message?: string): void;
  equal(actual: unknown, expected: unknown, message?: string): void;
  notEqual(actual: unknown, expected: unknown, message?: string): void;
  strictEqual(actual: unknown, expected: unknown, message?: string): void;
  notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
  deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
  notDeepEqual(actual: unknown, expected: unknown, message?: string): void;
  throws(fn: () => unknown, expected?: unknown, message?: string): void;
  doesNotThrow(fn: () => unknown, message?: string): void;
  rejects(promiseOrFn: Promise<unknown> | (() => Promise<unknown>), expected?: unknown, message?: string): Promise<void>;
  match(value: string, pattern: RegExp, message?: string): void;
  doesNotMatch(value: string, pattern: RegExp, message?: string): void;
  fail(message?: string): never;
}

declare module "node:test" {
  export const test: NodeTestFn;
  export const it: NodeTestFn;
  export const describe: {
    (name: string, fn: () => void | Promise<void>): Promise<void>;
    (name: string, options: object, fn: () => void | Promise<void>): Promise<void>;
  };
  export function before(fn: NodeTestBody, options?: object): void;
  export function after(fn: NodeTestBody, options?: object): void;
  export function beforeEach(fn: NodeTestBody, options?: object): void;
  export function afterEach(fn: NodeTestBody, options?: object): void;
  export default test;
}

declare module "node:assert" {
  const assert: NodeAssert;
  export default assert;
}

declare module "node:assert/strict" {
  const assert: NodeAssert;
  export default assert;
}

declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string;
  export function writeFileSync(path: string, data: string): void;
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
  export function readdirSync(path: string, options: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function dirname(path: string): string;
}

declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  cwd(): string;
  exit(code?: number): never;
};
