import type { ConfigSource } from "@pista/protocol";

/** Shown next to a setting that an organisation policy has locked, or whose default it set. Renders nothing otherwise.
 * Pass the whole field from `useConfigField` to get the source; `locked` alone keeps the plain badge. */
export function ManagedBadge({ locked, field }: { locked?: boolean; field?: { locked: boolean; source?: ConfigSource; policySource: string | null } }) {
  const isLocked = field ? field.locked : Boolean(locked);
  const path = field?.policySource;
  if (isLocked) {
    return (
      <span className="managed-badge" title={path ? `Locked by policy: ${path}` : "Managed by your organisation"}>
        Managed
      </span>
    );
  }
  if (field?.source === "policy") {
    return (
      <span className="managed-badge managed-badge-soft" title={path ? `Default from ${path}` : "Default set by your organisation"}>
        Org default
      </span>
    );
  }
  return null;
}
