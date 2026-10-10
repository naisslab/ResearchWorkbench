// The main process also changes the workspace (conference dates, catalog
// projects, imports) and returns the whole result. Local edits wait for such
// a change to land, so neither one overwrites the other.
let current: Promise<unknown> | null = null;

export function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = (current || Promise.resolve()).catch(() => {}).then(task);
  const release = () => {
    if (current === run) current = null;
  };
  current = run;
  void run.then(release, release);
  return run;
}

// Settles after every main-process change in flight; null when there is none,
// so an edit without a pending change still applies synchronously.
export function remoteChange(): Promise<unknown> | null {
  return current?.catch(() => {}) ?? null;
}
