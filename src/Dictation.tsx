import { useEffect, useRef, useState } from "react";
import { Check, Mic, X } from "lucide-react";
import type { DictationEvent } from "./types";

// The latest microphone levels, oldest first, drawn as a scrolling waveform.
const silence: number[] = Array(28).fill(0);

export default function Dictation({
  insert,
  disabled = false,
  onActive,
}: {
  insert(text: string): void;
  disabled?: boolean;
  onActive?(active: boolean): void;
}) {
  const [phase, setPhase] = useState("");
  const [language, setLanguage] = useState("");
  const [levels, setLevels] = useState(silence);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const session = useRef("");
  const callbacks = useRef({ insert, onActive });
  callbacks.current = { insert, onActive };
  useEffect(() => {
    const off = window.research!.onDictation((event: DictationEvent) => {
      if (event.id !== session.current) return;
      if (event.language) setLanguage(event.language);
      if (event.type === "preparing")
        setPhase(
          (event.message || "Preparing speech recognition…") +
            (event.progress ? ` ${Math.round(event.progress * 100)}%` : ""),
        );
      if (event.type === "listening") setPhase("Listening");
      if (event.type === "level")
        setLevels((current) => [...current.slice(1), event.value ?? 0]);
      if (event.type === "partial") setPreview(event.text || "");
      if (["final", "cancelled", "error"].includes(event.type)) {
        session.current = "";
        setPhase("");
        setLevels(silence);
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
    setLanguage("");
    setLevels(silence);
    setPhase("Starting microphone…");
    onActive?.(true);
    try {
      await window.research!.startDictation(id);
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
        className={`dictation-button ${phase ? "active" : ""}`}
        disabled={(disabled && !phase) || phase === "Finishing…"}
        aria-label={phase ? "Finish dictation" : "Start dictation"}
        title={phase ? "Finish dictation" : "Dictate"}
        onClick={() => {
          if (phase) {
            setPhase("Finishing…");
            void window.research!.stopDictation(session.current);
          } else void start();
        }}
      >
        {phase ? <Check size={19} /> : <Mic size={20} />}
      </button>
      {phase && (
        <button
          type="button"
          className="dictation-button"
          aria-label="Cancel dictation"
          onClick={() => void window.research!.cancelDictation(session.current)}
        >
          <X size={18} />
        </button>
      )}
      {phase && (
        <span className="dictation-preview" role="status">
          <span className="dictation-phase">
            {phase === "Listening" && (
              <span className="dictation-wave" aria-hidden="true">
                {levels.map((level, index) => (
                  <i key={index} style={{ height: `${3 + level * 15}px` }} />
                ))}
              </span>
            )}
            {phase === "Listening" && language
              ? `Listening · ${language}`
              : phase}
          </span>
          {preview}
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
