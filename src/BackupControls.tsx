import { useEffect, useState } from "react";
import type { BackupStatus } from "./types";
export default function BackupControls({
  report,
  notify,
}: {
  report(message: string): void;
  notify(message: string): void;
}) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [projects, setProjects] = useState(true);
  const [bind, setBind] = useState(false);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState<{
    files: number;
    bytes: number;
    current: string;
  }>();
  useEffect(() => window.research!.onBackupProgress(setProgress), []);
  useEffect(() => {
    void window
      .research!.backupStatus()
      .then(setStatus, (e) => report(e.message));
  }, []);
  async function backup() {
    setProgress(undefined);
    setBusy("Creating backup…");
    try {
      const ui: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        if (key.startsWith("research-workbench."))
          ui[key] = localStorage.getItem(key)!;
      }
      const result = await window.research!.createBackup({
        includeProjects: projects,
        ui,
      });
      if (result) {
        setStatus(result);
        notify(
          result.skipped.length
            ? "Backup created. Review the skipped items below."
            : "Backup created and checksums recorded.",
        );
      }
    } catch (error) {
      report((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function restore() {
    setBusy("Verifying and restoring…");
    try {
      const result = await window.research!.restoreBackup(bind);
      if (!result) return;
      try {
        const keys = Object.keys(localStorage).filter((key) =>
          key.startsWith("research-workbench."),
        );
        for (const key of keys) localStorage.removeItem(key);
        for (const [key, value] of Object.entries(result.ui))
          localStorage.setItem(key, value);
      } catch {
        report(
          "Workspace restored. Interface preferences could not be restored.",
        );
      }
      await window.research!.restartRestored();
    } catch (error) {
      report((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="complete-backup">
      <h3>Complete backup & restore</h3>
      <p className="form-help">
        Includes project metadata, PDF snapshots and annotations, conversation
        history, change backups, and interface state. Login credentials are
        excluded.
      </p>
      <label>
        <input
          type="checkbox"
          checked={projects}
          disabled={!!busy}
          onChange={(e) => setProjects(e.target.checked)}
        />{" "}
        Include attached project folders
      </label>
      <div className="backup-actions">
        <button
          className="button"
          disabled={!!busy}
          onClick={() => void backup()}
        >
          Create complete backup
        </button>
        <button
          className="button"
          disabled={!!busy}
          onClick={() => void restore()}
        >
          Restore backup…
        </button>
      </div>
      <label>
        <input
          type="checkbox"
          checked={bind}
          disabled={!!busy}
          onChange={(e) => setBind(e.target.checked)}
        />{" "}
        Assign restored conversations to the current signed-in account
      </label>
      <p className="form-help">
        Use this option after signing in on a new Mac. Restored project files go
        into a new folder; the current workspace remains available as a rollback
        copy.
      </p>
      {busy && (
        <p role="status">
          {busy}
          {progress && busy === "Creating backup…"
            ? ` ${progress.files.toLocaleString()} files · ${(progress.bytes / 1024 / 1024).toFixed(1)} MB`
            : ""}
        </p>
      )}
      {busy === "Creating backup…" && (
        <button
          className="button small"
          onClick={() =>
            void window.research!.cancelBackup().catch((e) => report(e.message))
          }
        >
          Cancel backup
        </button>
      )}
      {status && (
        <div className="form-help">
          <p>
            Last backup: {new Date(status.createdAt).toLocaleString()} ·{" "}
            {status.files.toLocaleString()} files ·{" "}
            {(status.bytes / 1024 / 1024).toFixed(1)} MB
          </p>
          <p>{status.path}</p>
          {!!status.skipped.length && (
            <details>
              <summary>{status.skipped.length} skipped items</summary>
              {status.skipped.map((item, i) => (
                <p key={i}>{item}</p>
              ))}
            </details>
          )}
        </div>
      )}
    </div>
  );
}
