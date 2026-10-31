import { isRecord } from "../../secrets.ts";

const positiveInt = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

/** Shape check for the sliced harness settings; a leaf module so the policy and the registry can both import it. */
export const validSliced = (v: unknown): boolean => {
  if (!isRecord(v) || !Object.keys(v).every((k) => ["minSlices", "maxParallel", "integrateTools", "repoSizeFraction"].includes(k))) return false;
  const { minSlices, maxParallel, integrateTools, repoSizeFraction } = v;
  return (
    (minSlices === undefined || positiveInt(minSlices)) &&
    (maxParallel === undefined || (positiveInt(maxParallel) && maxParallel <= 3)) &&
    (integrateTools === undefined || integrateTools === "read-only" || integrateTools === "full") &&
    (repoSizeFraction === undefined || (typeof repoSizeFraction === "number" && repoSizeFraction > 0 && repoSizeFraction <= 1))
  );
};
