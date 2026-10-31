/** An expected failure (bad input from the caller, a rule of the shop). `code` is stable; `message` is for people. */
export class DomainError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}
