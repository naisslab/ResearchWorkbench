import { useState } from "react";
import {
  BookOpen,
  FolderOpen,
  Link2,
  LoaderCircle,
  Upload,
} from "lucide-react";
import type { Workspace } from "./types";
import { exclusive } from "./workspace-lock";

export default function Welcome({
  imported,
  connect,
  report,
}: {
  imported(workspace: Workspace, projectId?: string): void;
  connect(): void;
  report(message: string): void;
}) {
  const [busy, setBusy] = useState("");
  async function open(kind: "folder" | "example" | "manifest") {
    setBusy(kind);
    try {
      await exclusive(async () => {
        if (kind === "manifest") {
          const next = await window.research!.importProject();
          if (next) imported(next, next.projects.at(-1)?.id);
        } else {
          const result = await window.research!.openResearchProject(kind);
          if (result) imported(result.workspace, result.projectId);
        }
      });
    } catch (e) {
      report((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="welcome-card detail-card">
      <span className="sample-tag">YOUR WORKSPACE</span>
      <h2>Bring your research together</h2>
      <p>
        Open a manuscript, review a PDF, or plan your next paper. Your files
        stay in their own folders.
      </p>
      <div className="welcome-options">
        <button
          className="button primary"
          disabled={!!busy}
          onClick={() => void open("folder")}
        >
          <FolderOpen size={18} /> Open a folder
        </button>
        <button className="button" disabled={!!busy} onClick={connect}>
          <Link2 size={18} /> Connect Overleaf
        </button>
        <button
          className="button"
          disabled={!!busy}
          onClick={() => void open("example")}
        >
          <BookOpen size={18} /> Try an example
        </button>
        <button
          className="button"
          disabled={!!busy}
          onClick={() => void open("manifest")}
        >
          <Upload size={18} /> Import project metadata
        </button>
      </div>
      {busy && (
        <p role="status">
          <LoaderCircle size={14} className="spin" /> Opening project…
        </p>
      )}
      <p className="form-help">
        No sign-in required. Start with local files or a source ZIP extracted
        from Overleaf. Check your LaTeX setup in Workspace settings when you are
        ready to compile.
      </p>
    </section>
  );
}
