import { memo, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { RotateCcw, PlugZap } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import type { Project } from "./types";
import { useDark } from "./theme";
const lightTerminalTheme = {
  background: "#fafbfc",
  foreground: "#565869",
  cursor: "#565869",
  cursorAccent: "#fafbfc",
  selectionBackground: "#dceef8",
  black: "#565869",
  brightBlack: "#75798f",
  white: "#75798f",
  brightWhite: "#565869",
  green: "#3a7b4b",
  brightGreen: "#4a8f5c",
  blue: "#3174a1",
  brightBlue: "#3f86b5",
  red: "#b2504b",
  brightRed: "#c4615b",
  yellow: "#866a2a",
  brightYellow: "#9c7d33",
  magenta: "#a45280",
  brightMagenta: "#b8669a",
  cyan: "#297a76",
  brightCyan: "#358f8a",
};
const darkTerminalTheme = {
  background: "#1f1f1f",
  foreground: "#cccccc",
  cursor: "#cccccc",
  cursorAccent: "#1f1f1f",
  selectionBackground: "#264f78",
  black: "#1f1f1f",
  brightBlack: "#666666",
  white: "#cccccc",
  brightWhite: "#ffffff",
  red: "#cd3131",
  brightRed: "#f14c4c",
  green: "#0dbc79",
  brightGreen: "#23d18b",
  yellow: "#e5e510",
  brightYellow: "#f5f543",
  blue: "#2472c8",
  brightBlue: "#3b8eea",
  magenta: "#bc3fbc",
  brightMagenta: "#d670d6",
  cyan: "#11a8cd",
  brightCyan: "#29b8db",
};
export default memo(function TerminalPanel({
  project,
  report,
}: {
  project: Project;
  report(message: string): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const dark = useDark();
  const terminalRef = useRef<Terminal | null>(null);
  const [mode, setMode] = useState<"local" | "ssh">("local");
  const [revision, setRevision] = useState(0);
  const [connected, setConnected] = useState(false);
  const currentKey = useRef("");
  useEffect(() => {
    if (terminalRef.current)
      terminalRef.current.options.theme = dark
        ? darkTerminalTheme
        : lightTerminalTheme;
  }, [dark]);
  useEffect(() => {
    const api = window.research;
    if (!api || !container.current) return;
    let disposed = false;
    let ready = false;
    let queued = "";
    let size = "";
    let resizeTimer = 0;
    const key = `${project.id}:${mode}`;
    currentKey.current = key;
    setConnected(false);
    const terminal = new Terminal({
      fontFamily:
        '"JetBrains Mono Variable", "SFMono-Regular", Menlo, monospace',
      fontSize: 12.5,
      cursorBlink: true,
      theme: dark ? darkTerminalTheme : lightTerminalTheme,
      allowProposedApi: false,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    terminalRef.current = terminal;
    terminal.loadAddon(fit);
    terminal.open(container.current);
    // Fit on every resize, but tell the pty only once the size settles.
    const fitTerminal = () => {
      if (disposed || !container.current?.clientHeight) return;
      fit.fit();
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const next = `${terminal.cols}x${terminal.rows}`;
        if (!ready || next === size) return;
        size = next;
        void api
          .resizeTerminal(key, terminal.cols, terminal.rows)
          .catch((error) => report(error.message));
      }, 100);
    };
    const observer = new ResizeObserver(fitTerminal);
    observer.observe(container.current);
    fitTerminal();
    const offData = api.onTerminalData((data) => {
      if (data.key === key && !disposed) {
        if (ready) terminal.write(data.text);
        else queued += data.text;
      }
    });
    const offExit = api.onTerminalExit((data) => {
      if (data.key === key && !disposed) {
        setConnected(false);
        terminal.writeln(
          `\r\n[Session exited: ${data.exitCode}. Use Restart to reconnect.]`,
        );
      }
    });
    const input = terminal.onData((text) => {
      if (ready)
        void api
          .writeTerminal(key, text)
          .catch((error) => report(error.message));
    });
    void api
      .startTerminal(project.id, mode)
      .then((session) => {
        if (disposed) return;
        ready = true;
        terminal.write(session.history + queued);
        queued = "";
        setConnected(true);
        fitTerminal();
      })
      .catch((error) => {
        if (!disposed) {
          terminal.writeln(`\r\n${error.message}`);
          report(error.message);
        }
      });
    return () => {
      disposed = true;
      clearTimeout(resizeTimer);
      observer.disconnect();
      offData();
      offExit();
      input.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [project.id, project.folder, project.sshHost, mode, revision, report]);
  return (
    <section className="terminal-panel">
      <div className="terminal-toolbar">
        <div className="terminal-modes">
          <button
            className={mode === "local" ? "active" : ""}
            onClick={() => setMode("local")}
          >
            Local shell
          </button>
          <button
            disabled={!project.sshHost}
            title={project.sshHost || "Set an SSH host in project details"}
            className={mode === "ssh" ? "active" : ""}
            onClick={() => setMode("ssh")}
          >
            <PlugZap size={12} /> {project.sshHost || "SSH"}
          </button>
        </div>
        <span className="terminal-status">
          <i className={connected ? "live-dot" : "idle-dot"} />
          {connected ? "Connected" : "Disconnected"}
        </span>
        <button
          className="icon-button light"
          title="Restart session"
          onClick={async () => {
            await window.research?.stopTerminal(currentKey.current);
            setRevision((x) => x + 1);
          }}
        >
          <RotateCcw size={14} />
        </button>
      </div>
      <div className="terminal-container" ref={container} />
    </section>
  );
});
