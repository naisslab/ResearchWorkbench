import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { TerminalSquare, RotateCcw, PlugZap, X } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import type { Project } from "./types";
import { useColorTheme } from "./theme";
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
export default function TerminalPanel({
  project,
  onClose,
  report,
}: {
  project: Project;
  onClose(): void;
  report(message: string): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const dark = useColorTheme();
  const terminalRef = useRef<Terminal | null>(null);
  const lightThemeRef = useRef<Terminal["options"]["theme"]>(undefined);
  useEffect(() => {
    if (terminalRef.current)
      terminalRef.current.options.theme = dark
        ? darkTerminalTheme
        : lightThemeRef.current;
  }, [dark]);
  const [mode, setMode] = useState<"local" | "ssh">("local");
  const [revision, setRevision] = useState(0);
  const [connected, setConnected] = useState(false);
  const currentKey = useRef("");
  useEffect(() => {
    const api = window.research;
    if (!api || !container.current) return;
    let disposed = false;
    let ready = false;
    let queued = "";
    const key = `${project.id}:${mode}`;
    currentKey.current = key;
    setConnected(false);
    const terminal = new Terminal({
      fontFamily:
        '"JetBrains Mono Variable", "SFMono-Regular", Menlo, monospace',
      fontSize: 12.5,
      cursorBlink: true,
      theme: {
        background: "#fafbfc",
        foreground: "#565869",
        cursor: "#565869",
        cursorAccent: "#fafbfc",
        selectionBackground: "#dceef8",
        black: "#565869",
        brightBlack: "#75798f",
        white: "#75798f",
        brightWhite: "#565869",
        green: "#238744",
        brightGreen: "#2dae58",
        blue: "#087cba",
        brightBlue: "#09a1ed",
        red: "#d34b47",
        brightRed: "#ff5c57",
        yellow: "#9a7400",
        brightYellow: "#cf9c00",
        magenta: "#c25193",
        brightMagenta: "#f767bb",
        cyan: "#00918d",
        brightCyan: "#13bbb7",
      },
      allowProposedApi: false,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    terminalRef.current = terminal;
    lightThemeRef.current = terminal.options.theme;
    if (document.documentElement.dataset.theme === "dark")
      terminal.options.theme = darkTerminalTheme;
    terminal.loadAddon(fit);
    terminal.open(container.current);
    const fitTerminal = () => {
      if (!disposed && container.current?.clientHeight) {
        fit.fit();
        if (ready)
          void api
            .resizeTerminal(key, terminal.cols, terminal.rows)
            .catch((error) => report(error.message));
      }
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
        terminal.focus();
      })
      .catch((error) => {
        if (!disposed) {
          terminal.writeln(`\r\n${error.message}`);
          report(error.message);
        }
      });
    return () => {
      disposed = true;
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
        <span className="terminal-label">
          <TerminalSquare size={14} /> TERMINAL
        </span>
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
        <button
          className="icon-button light"
          title="Hide terminal"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>
      <div className="terminal-container" ref={container} />
    </section>
  );
}
