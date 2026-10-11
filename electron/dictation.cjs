const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
const languages = new Set(["en-US", "zh-CN", "zh-TW", "zh-HK"]);

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
  function start(id, language) {
    if (platform !== "darwin")
      throw new Error("Dictation is available on macOS.");
    if (
      typeof id !== "string" ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(id) ||
      !languages.has(language)
    )
      throw new Error("Choose a supported dictation language.");
    if (active) throw new Error("Finish the current dictation first.");
    const proc = spawnProcess(executable, [language], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const session = { id, proc, text: "", timeout: null };
    active = session;
    let buffer = "";
    const decoder = new StringDecoder("utf8");
    const finish = (event) => {
      if (active !== session) return;
      active = undefined;
      clearTimeout(session.timeout);
      proc.kill();
      emit({ id, ...event });
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
          if (["final", "error", "cancelled"].includes(event.type))
            finish({
              type: event.type,
              text: session.text,
              message:
                typeof event.message === "string"
                  ? event.message.slice(0, 1000)
                  : undefined,
            });
          else if (["partial", "listening"].includes(event.type))
            emit({ id, type: event.type, text: session.text });
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
    session.timeout = setTimeout(
      () =>
        finish({
          type: "error",
          text: session.text,
          message:
            "Dictation timed out. Check the macOS permission dialog and try again.",
        }),
      120000,
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
