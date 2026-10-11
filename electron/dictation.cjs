const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");

function createDictation({
  executable,
  emit,
  spawnProcess = spawn,
  platform = process.platform,
}) {
  let active;
  function cancel(id) {
    if (!active || (id && id !== active.id)) return;
    const session = active;
    active = undefined;
    clearTimeout(session.timeout);
    session.proc.kill();
    emit({ id: session.id, type: "cancelled", text: "" });
  }
  function start(id) {
    if (platform !== "darwin")
      throw new Error("Dictation is available on macOS.");
    if (typeof id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(id))
      throw new Error("Invalid dictation session.");
    if (active) throw new Error("Finish the current dictation first.");
    const proc = spawnProcess(executable, [], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const session = { id, proc, text: "", language: "", timeout: null };
    active = session;
    // Until the microphone opens, the helper may wait on a permission dialog
    // or a first-use model download; a silent helper is given up on.
    const wait = (ms, message) => {
      clearTimeout(session.timeout);
      session.timeout = setTimeout(
        () => finish({ type: "error", text: session.text, message }),
        ms,
      );
    };
    let buffer = "";
    const decoder = new StringDecoder("utf8");
    const finish = (event) => {
      if (active !== session) return;
      active = undefined;
      clearTimeout(session.timeout);
      proc.kill();
      emit({ id, ...event, language: session.language });
    };
    proc.stdout.on("data", (bytes) => {
      if (active !== session) return;
      buffer += decoder.write(bytes);
      if (buffer.length > 100000)
        return finish({
          type: "error",
          text: session.text,
          message: "Dictation output exceeded its limit.",
        });
      let end;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          const event = JSON.parse(line);
          if (typeof event.text === "string")
            session.text = event.text.slice(0, 20000);
          if (typeof event.language === "string" && event.language)
            session.language = event.language.slice(0, 100);
          const message =
            typeof event.message === "string"
              ? event.message.slice(0, 1000)
              : undefined;
          if (["final", "error", "cancelled"].includes(event.type))
            finish({ type: event.type, text: session.text, message });
          else if (event.type === "level") {
            if (Number.isFinite(event.value))
              emit({
                id,
                type: "level",
                value: Math.max(0, Math.min(1, event.value)),
              });
          } else if (event.type === "preparing") {
            wait(120000, "The speech model download stalled. Try again.");
            emit({
              id,
              type: "preparing",
              message,
              ...(Number.isFinite(event.progress) && {
                progress: Math.max(0, Math.min(1, event.progress)),
              }),
            });
          } else if (["partial", "listening"].includes(event.type)) {
            // The helper ends a dictation after five minutes.
            if (event.type === "listening")
              wait(330000, "Dictation stopped responding. Try again.");
            emit({
              id,
              type: event.type,
              text: session.text,
              language: session.language,
            });
          }
        } catch {
          finish({
            type: "error",
            text: session.text,
            message: "Could not read dictation output. Try again.",
          });
        }
      }
    });
    proc.stderr.on("data", () => {});
    proc.stdin.on("error", () => {});
    proc.on("error", () =>
      finish({
        type: "error",
        text: session.text,
        message:
          "The dictation helper is missing. Rebuild or reinstall Research Workbench.",
      }),
    );
    proc.on("close", () =>
      finish({
        type: "error",
        text: session.text,
        message:
          "Dictation stopped unexpectedly. Check microphone and speech recognition permissions.",
      }),
    );
    wait(
      120000,
      "Dictation timed out. Check the macOS permission dialog and try again.",
    );
    return { id };
  }
  function stop(id) {
    if (active?.id === id && active.proc.stdin.writable)
      active.proc.stdin.write("stop\n");
  }
  return { start, stop, cancel };
}
module.exports = { createDictation };
