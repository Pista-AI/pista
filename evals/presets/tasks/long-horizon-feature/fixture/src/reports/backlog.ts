export function backlogLabel(count: number): string {
  return count === 1 ? "1 backlog" : `${count} backlogs`;
}
