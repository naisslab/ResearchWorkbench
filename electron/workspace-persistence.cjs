const { createTaskQueue } = require("./task-queue.cjs");

// The persisted snapshot is authoritative. A failed write never changes the
// state observed by another handler, and later updates start from that state.
function createWorkspacePersistence({
  read,
  persist,
  validate,
  commit,
  before,
  queue = createTaskQueue(),
}) {
  const update = (transform, reason) =>
    queue(async () => {
      const current = read();
      const proposed = await transform(current);
      if (proposed === current) return current;
      const next = validate(structuredClone(proposed));
      if (reason) await before?.(reason);
      await persist(next);
      commit(next, current);
      return next;
    });
  return {
    update,
    replace: (next) => {
      const snapshot = structuredClone(next);
      validate(snapshot);
      return update(() => snapshot);
    },
    settled: queue.settled,
  };
}
module.exports = { createWorkspacePersistence };
