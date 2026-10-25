// One definition of "looks like a secret", shared by the policy loader, `pista policy check` and the audit redaction.

/** Words that mark a key, flag or variable name as secret-bearing. Used as a regex alternation. */
export const SECRET_WORDS = "token|secret|password|passwd|api[ _-]?key|authorization|credentials?|bearer|cookie";

/** A long literal that is not a path, URL or $ENV reference: probably a pasted secret. */
export const looksLikeSecret = (value: string): boolean => value.length > 40 && !/^(\/|\.\/|~|https?:)/.test(value) && !/\$\{?[A-Za-z_]/.test(value);

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
