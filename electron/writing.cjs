const crypto = require("node:crypto");
const writingTool = {
  type: "function",
  name: "record_writing_items",
  description:
    "Save to-dos and/or append a research note in the current Research Workbench project. Use when the user asks to record, remember, or add writing tasks/notes, including dictated requests. Preserve their language and technical meaning. Do not modify workspace.json directly. Only report saved after this tool succeeds.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      tasks: {
        type: "array",
        maxItems: 20,
        items: { type: "string", minLength: 1, maxLength: 500 },
      },
      note: { type: "string", maxLength: 8000 },
    },
    required: ["tasks", "note"],
  },
};
function validateCapture(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !["tasks", "note"].includes(key)) ||
    !Array.isArray(value.tasks) ||
    value.tasks.length > 20 ||
    value.tasks.some(
      (s) => typeof s !== "string" || !s.trim() || s.length > 500,
    ) ||
    typeof value.note !== "string" ||
    value.note.length > 8000 ||
    (!value.tasks.length && !value.note.trim())
  )
    throw new Error("Provide up to 20 writing to-dos and/or a research note.");
  return {
    tasks: [...new Set(value.tasks.map((s) => s.trim()))],
    note: value.note.trim(),
  };
}
function createWritingCapture(emit) {
  const pending = new Map();
  function request(projectId, value, signal) {
    const capture = validateCapture(value);
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const finish = (error, result) => {
        if (!pending.delete(id)) return;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        error ? reject(new Error(error)) : resolve(result);
      };
      const abort = () => finish("The writing request was stopped.");
      const timer = setTimeout(
        () =>
          finish("The workspace did not save the writing items. Try again."),
        15000,
      );
      pending.set(id, finish);
      signal.addEventListener("abort", abort, { once: true });
      emit({ id, projectId, capture });
    });
  }
  function complete(id, result) {
    const finish = pending.get(id);
    if (!finish) return false;
    if (result?.saved === true)
      finish(null, {
        saved: true,
        destination: "Project details: Next steps / Research notes",
      });
    else
      finish(
        "Writing items could not be saved. The project may have closed or a disk write failed.",
      );
    return true;
  }
  function cancel() {
    for (const finish of pending.values())
      finish("The workspace closed before the writing items were saved.");
  }
  return { request, complete, cancel };
}
module.exports = { writingTool, validateCapture, createWritingCapture };
