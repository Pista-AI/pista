/** Shown next to a setting that an organisation policy has locked. Renders nothing when unlocked. */
export function ManagedBadge({ locked }: { locked: boolean }) {
  return locked ? (
    <span className="managed-badge" title="Managed by your organisation">
      Managed
    </span>
  ) : null;
}
