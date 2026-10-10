// Calls with the same key run in order. A failure reaches its caller without
// blocking later work; independent keys can progress concurrently.
function createTaskQueue() {
  const pending = new Map();
  const run = (task, key) => {
    const next = (pending.get(key) || Promise.resolve())
      .catch(() => {})
      .then(task);
    pending.set(key, next);
    const release = () => {
      if (pending.get(key) === next) pending.delete(key);
    };
    // Handle both outcomes without creating an unobserved rejection in cleanup.
    void next.then(release, release);
    return next;
  };
  // Resolves once every task queued so far has finished, whatever its outcome.
  return Object.assign(run, {
    settled: () => Promise.allSettled([...pending.values()]),
  });
}
module.exports = { createTaskQueue };
