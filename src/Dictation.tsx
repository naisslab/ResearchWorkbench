import { useEffect, useRef, useState } from "react";
import { Mic, Square, X } from "lucide-react";
import type { DictationEvent } from "./types";

export default function Dictation({
  insert,
  disabled = false,
  onActive,
}: {
  insert(text: string): void;
  disabled?: boolean;
  onActive?(active: boolean): void;
}) {
  const [language, setLanguage] = useState(
    () =>
      localStorage.getItem("research-workbench.dictation-language") || "zh-CN",
  );
  const [phase, setPhase] = useState("");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const session = useRef("");
  const callbacks = useRef({ insert, onActive });
  callbacks.current = { insert, onActive };
  useEffect(() => {
    const off = window.research!.onDictation((event: DictationEvent) => {
      if (event.id !== session.current) return;
      if (event.type === "listening") setPhase("Listening…");
      if (event.type === "partial") setPreview(event.text || "");
      if (["final", "cancelled", "error"].includes(event.type)) {
        session.current = "";
        setPhase("");
        callbacks.current.onActive?.(false);
        if (event.type !== "cancelled" && event.text?.trim())
          callbacks.current.insert(event.text.trim());
        setPreview("");
        setError(
          event.type === "error"
            ? event.message || "Dictation failed."
            : event.type === "final" && !event.text?.trim()
              ? "No speech was detected. Try again."
              : "",
        );
      }
    });
    return () => {
      off();
      if (session.current)
        void window.research!.cancelDictation(session.current);
      callbacks.current.onActive?.(false);
    };
  }, []);
  useEffect(() => {
    if (disabled && session.current)
      void window.research!.cancelDictation(session.current);
  }, [disabled]);
  async function start() {
    if (session.current) return;
    const id = crypto.randomUUID();
    session.current = id;
    setError("");
    setPreview("");
    setPhase("Starting microphone…");
    onActive?.(true);
    try {
      await window.research!.startDictation(id, language);
    } catch (error) {
      if (session.current === id) {
        session.current = "";
        setPhase("");
        onActive?.(false);
        setError((error as Error).message);
      }
    }
  }
  return (
    <div className="dictation-control">
      <button
        type="button"
        className={`button text small ${phase ? "active" : ""}`}
        disabled={disabled && !phase}
        aria-label={phase ? "Finish dictation" : "Start dictation"}
        title="Dictate editable text with macOS speech recognition"
        onClick={() => {
          if (phase) {
            setPhase("Finishing…");
            void window.research!.stopDictation(session.current);
          } else void start();
        }}
      >
        {phase ? <Square size={13} /> : <Mic size={13} />}
        {phase || "Dictate"}
      </button>
      <select
        aria-label="Dictation language"
        value={language}
        disabled={!!phase}
        onChange={(event) => {
          setLanguage(event.target.value);
          localStorage.setItem(
            "research-workbench.dictation-language",
            event.target.value,
          );
        }}
      >
        <option value="zh-CN">普通话</option>
        <option value="en-US">English</option>
        <option value="zh-TW">國語</option>
        <option value="zh-HK">廣東話</option>
      </select>
      {phase && (
        <button
          type="button"
          className="icon-button"
          aria-label="Cancel dictation"
          onClick={() => void window.research!.cancelDictation(session.current)}
        >
          <X size={13} />
        </button>
      )}
      <small className="dictation-privacy">
        macOS speech recognition; some languages use Apple’s service.
      </small>
      {phase && (
        <span className="dictation-preview" role="status">
          {preview ||
            "Speak, then click Finish. Text is not sent automatically."}
        </span>
      )}
      {error && (
        <span className="dictation-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
