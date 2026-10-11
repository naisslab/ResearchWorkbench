import { useState } from "react";
import { SlidersHorizontal, RefreshCw } from "lucide-react";
import Modal from "./Modal";
import { unwrap } from "./ai-result";
import type {
  AINativeReviewTarget,
  AINativeSettings,
  AINativeSettingsAction,
} from "./types";

export default function AINativeTools({
  projectId,
  disabled,
  running,
  review,
  report,
}: {
  projectId: string;
  disabled: boolean;
  running: boolean;
  review(target: AINativeReviewTarget): Promise<void>;
  report(message: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<AINativeSettings>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [target, setTarget] =
    useState<AINativeReviewTarget["type"]>("uncommittedChanges");
  const [ref, setRef] = useState("");
  const [name, setName] = useState("");
  const [transport, setTransport] = useState("http");
  const [endpoint, setEndpoint] = useState("");
  const [args, setArgs] = useState("[]");
  async function update(request: AINativeSettingsAction = { action: "read" }) {
    setBusy(true);
    setNotice("");
    try {
      setSettings(
        await unwrap(window.research!.aiNativeSettings(projectId, request)),
      );
      if (request.action === "login")
        setNotice("Finish sign-in in your browser, then refresh connections.");
      if (request.action === "addServer") {
        setName("");
        setEndpoint("");
        setArgs("[]");
      }
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="ai-toolbar-button"
        title="Agent tools and connections"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          void update();
        }}
      >
        <SlidersHorizontal size={14} /> Tools
      </button>
      {open && (
        <Modal title="Agent tools" onClose={() => setOpen(false)}>
          <div className="ai-native-tools">
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                try {
                  await review(
                    target === "uncommittedChanges"
                      ? { type: target }
                      : target === "baseBranch"
                        ? { type: target, branch: ref }
                        : { type: target, sha: ref },
                  );
                  setOpen(false);
                } catch (error) {
                  report((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <strong>Code review</strong>
              <p className="muted">
                Run Codex’s reviewer on this project. Findings appear in the
                current chat with Read only permissions.
              </p>
              <label>
                Review target
                <select
                  aria-label="Review target"
                  value={target}
                  onChange={(event) =>
                    setTarget(event.target.value as typeof target)
                  }
                >
                  <option value="uncommittedChanges">
                    Uncommitted changes
                  </option>
                  <option value="baseBranch">Changes against a branch</option>
                  <option value="commit">A commit</option>
                </select>
              </label>
              {target !== "uncommittedChanges" && (
                <label>
                  {target === "baseBranch" ? "Base branch" : "Commit"}
                  <input
                    aria-label="Review reference"
                    required
                    value={ref}
                    onChange={(event) => setRef(event.target.value)}
                    placeholder={
                      target === "baseBranch" ? "main" : "Commit SHA"
                    }
                  />
                </label>
              )}
              <button className="button" disabled={busy || running}>
                Start code review
              </button>
            </form>
            <section>
              <strong>Web search</strong>
              <p className="muted">
                Choose cached results or live web access. Availability depends
                on the model and your account.
              </p>
              <select
                aria-label="Web search"
                value={settings?.webSearch || "cached"}
                disabled={!settings || busy || running}
                onChange={(event) =>
                  void update({
                    action: "webSearch",
                    value: event.target.value as AINativeSettings["webSearch"],
                  })
                }
              >
                <option value="disabled">Off</option>
                <option value="cached">Cached</option>
                <option value="live">Live</option>
              </select>
            </section>
            <section>
              <div className="ai-native-heading">
                <strong>MCP connections</strong>
                <button
                  className="button small"
                  disabled={busy}
                  onClick={() => void update()}
                >
                  <RefreshCw size={13} /> Refresh connections
                </button>
              </div>
              <p className="muted">
                Connections and web search settings apply to this ChatGPT
                account in Workbench. Changes apply to subsequent turns.
              </p>
              {running && (
                <p className="muted">
                  Wait for active agents to finish before changing these
                  settings.
                </p>
              )}
              {!settings && (
                <p>
                  {busy
                    ? "Loading connections…"
                    : "Connections could not be loaded."}
                </p>
              )}
              {settings?.servers.length === 0 && (
                <p className="muted">No connections configured.</p>
              )}
              {settings?.servers.map((server) => (
                <div className="ai-native-server" key={server.name}>
                  <strong>{server.name}</strong>
                  <small>
                    {!server.enabled
                      ? "Disabled"
                      : server.error ||
                        (server.authStatus === "notLoggedIn"
                          ? "Sign-in required"
                          : server.state ||
                            `${server.toolCount} tools available`)}
                    {server.origin ? ` · ${server.origin}` : ""}
                  </small>
                  {!!server.tools.length && (
                    <details>
                      <summary>Available tools ({server.toolCount})</summary>
                      <ul>
                        {server.tools.map((tool) => (
                          <li key={tool}>{tool}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <div className="ai-approval-actions">
                    {server.enabled && server.authStatus !== "unsupported" && (
                      <button
                        className="button small"
                        disabled={busy || running}
                        onClick={() =>
                          void update({ action: "login", name: server.name })
                        }
                      >
                        Sign in to {server.name}
                      </button>
                    )}
                    <button
                      className="button small"
                      disabled={busy || running}
                      onClick={() =>
                        void update({
                          action: "toggleServer",
                          name: server.name,
                          enabled: !server.enabled,
                        })
                      }
                    >
                      {server.enabled ? "Disable" : "Enable"} {server.name}
                    </button>
                  </div>
                </div>
              ))}
              <details>
                <summary>Add connection</summary>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    try {
                      void update({
                        action: "addServer",
                        name,
                        ...(transport === "http"
                          ? { url: endpoint }
                          : { command: endpoint, args: JSON.parse(args) }),
                      });
                    } catch {
                      setNotice(
                        'Enter arguments as a JSON list, for example ["--port", "3000"].',
                      );
                    }
                  }}
                >
                  <label>
                    Name
                    <input
                      required
                      pattern="[a-zA-Z0-9_-]{1,64}"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                  <label>
                    Connection type
                    <select
                      value={transport}
                      onChange={(event) => {
                        setTransport(event.target.value);
                        setEndpoint("");
                      }}
                    >
                      <option value="http">HTTP endpoint</option>
                      <option value="stdio">Local command</option>
                    </select>
                  </label>
                  <label>
                    {transport === "http" ? "MCP endpoint" : "Command"}
                    <input
                      required
                      value={endpoint}
                      onChange={(event) => setEndpoint(event.target.value)}
                      placeholder={
                        transport === "http"
                          ? "https://example.com/mcp"
                          : "/path/to/server"
                      }
                    />
                  </label>
                  {transport === "stdio" && (
                    <label>
                      Arguments (JSON list)
                      <input
                        required
                        value={args}
                        onChange={(event) => setArgs(event.target.value)}
                      />
                    </label>
                  )}
                  <button className="button" disabled={busy || running}>
                    Add connection
                  </button>
                </form>
              </details>
            </section>
            {notice && <p role="status">{notice}</p>}
          </div>
        </Modal>
      )}
    </>
  );
}
