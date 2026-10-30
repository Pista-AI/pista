// notifications: subject helpers.

/** Known subject codes and what they mean. */
export const SUBJECT_CODES: Record<string, string> = {
  SU01: "partial subject route",
  SU02: "primary subject window",
  SU03: "secondary subject policy",
  SU04: "legacy subject rule",
  SU05: "trial subject check",
  SU06: "internal subject ticket",
  SU07: "external subject queue",
  SU08: "priority subject slot",
  SU09: "deferred subject lane",
  SU10: "standard subject tier",
  SU11: "express subject group",
  SU12: "fragile subject profile",
  SU13: "bulky subject rate",
  SU14: "seasonal subject cap",
  SU15: "returnable subject quota",
  SU16: "perishable subject cycle",
  SU17: "regulated subject ledger",
  SU18: "oversized subject session",
  SU19: "premium subject contact",
  SU20: "discounted subject notice",
  SU21: "limited subject plan",
  SU22: "archived subject request",
  SU23: "pending subject record",
  SU24: "verified subject entry",
};

/** Description of a subject code, or "unknown subject code: <code>". */
export function describeSubject(code: string): string {
  return SUBJECT_CODES[code] ?? `unknown subject code: ${code}`;
}

/** Whether `n` is a whole number inside the subject limits (2 to 118). */
export function isSubjectValid(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 118;
}

export function clampSubject(n: number): number {
  return Math.min(118, Math.max(2, Math.trunc(n)));
}

const WEIGHTS: Record<string, number> = { a: 19, b: 20, c: 21 };

/** Relative weight of a subject class; unknown classes weigh nothing. */
export function subjectWeight(key: string): number {
  return WEIGHTS[key] ?? 0;
}

export function totalSubjectWeight(keys: string[]): number {
  return keys.reduce((sum, key) => sum + subjectWeight(key), 0);
}

/** Scales a subject amount by the module factor and rounds to a whole number. */
export function subjectScale(value: number, factor = 5): number {
  return Math.round(value * factor);
}

export function subjectShare(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
