import { useSyncExternalStore } from "react";

type Manuscript = { file: string; dirty: boolean };
// Kept outside React state so a status change re-renders only this span.
let status: {
  workspace: string;
  retry?: () => void;
  manuscript: Manuscript | null;
} = { workspace: "Saved locally", manuscript: null };
const listeners = new Set<() => void>();
function update(next: Partial<typeof status>) {
  status = { ...status, ...next };
  listeners.forEach((listener) => listener());
}
export const setSaveStatus = (workspace: string, retry?: () => void) =>
  update({ workspace, retry });
export const setManuscriptStatus = (manuscript: Manuscript | null) =>
  update({ manuscript });
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export default function SaveStatus({ workbench }: { workbench: boolean }) {
  const { workspace, retry, manuscript } = useSyncExternalStore(
    subscribe,
    () => status,
  );
  const file = workbench ? manuscript : null;
  if (!file && (workbench || workspace === "Saved locally"))
    return <span role="status" />;
  const [text, tone] = file
    ? file.dirty
      ? [`${file.file} · Unsaved (⌘S)`, "warning"]
      : [`${file.file} saved`, undefined]
    : [workspace, retry && "danger"];
  return (
    <span role="status" data-tone={tone}>
      <i className="live-dot" /> {text}
      {!file && retry && (
        <button className="button text small" onClick={retry}>
          Retry
        </button>
      )}
    </span>
  );
}
