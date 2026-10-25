export function RoleBadge({ role }: { role: string }) {
  return <span className={`badge role-badge ${role}`}>{role}</span>;
}
