/** Keep recent idle views while preserving every view with unfinished work. */
export function retainedWorkbenches(
  opened: string[],
  active: string,
  protectedIds: ReadonlySet<string>,
  idleLimit = 6,
) {
  const recent = [...new Set(opened)];
  const idle = recent.filter((id) => id !== active && !protectedIds.has(id));
  const keep = new Set(idleLimit > 0 ? idle.slice(-idleLimit) : []);
  return recent.filter(
    (id) => id === active || protectedIds.has(id) || keep.has(id),
  );
}
