import { useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import type { SetupTool } from "./release-types";

export default function SetupDiagnostics() {
  const [items, setItems] = useState<SetupTool[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function check() {
    setBusy(true);
    setError("");
    try {
      setItems(await window.research!.setupDiagnostics());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="detail-card setup-diagnostics">
      <div className="section-heading">
        <h2>Check your setup</h2>
        <button className="button" onClick={() => void check()} disabled={busy}>
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <RefreshCw size={16} />
          )}{" "}
          {busy ? "Checking…" : "Check tools"}
        </button>
      </div>
      <p className="muted">
        Project planning and PDF reading work without TeX or an AI account.
        Local compilation and source synchronization use the tools below.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {items && (
        <ul className="setup-tools">
          {items.map((item) => (
            <li key={item.id}>
              {item.available ? (
                <CheckCircle2 size={18} />
              ) : (
                <CircleAlert size={18} />
              )}
              <div>
                <strong>{item.name}</strong>
                <span>{item.purpose}</span>
                <small>{item.available ? item.version : item.message}</small>
                {item.path && <code>{item.path}</code>}
              </div>
              {!item.available && (
                <button
                  className="button small"
                  onClick={() => void window.research!.openLink(item.url)}
                >
                  Installation guide
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="form-help">
        AI requests send the selected context and tool results to your connected
        provider. Local editing, review, and backups do not require AI.
      </p>
    </section>
  );
}
