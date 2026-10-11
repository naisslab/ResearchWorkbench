const crypto = require("node:crypto");
// Agent tools that run in the window: it owns workspace saves (a change made
// here would be overwritten by its next whole-workspace save) and manuscript
// checks. The tool fails unless the window confirms, so the agent never
// reports work that did not happen.
function createWindowTools(emit) {
  const pending = new Map();
  function request(projectId, tool, input, signal, timeout = 15000) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const finish = (error, result) => {
        if (!pending.delete(id)) return;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        error ? reject(new Error(error)) : resolve(result);
      };
      const abort = () => finish("The request was stopped.");
      const timer = setTimeout(
        () => finish("The workbench did not respond. Try again."),
        timeout,
      );
      pending.set(id, finish);
      signal.addEventListener("abort", abort, { once: true });
      emit({ id, projectId, tool, input });
    });
  }
  function complete(id, response) {
    const finish = pending.get(id);
    if (!finish) return false;
    if (response?.ok === true) finish(null, response.result ?? {});
    else
      finish(
        typeof response?.error === "string" && response.error
          ? response.error.slice(0, 2000)
          : "The workbench could not complete this request.",
      );
    return true;
  }
  function cancel() {
    for (const finish of pending.values())
      finish("The window closed before the request finished.");
  }
  return { request, complete, cancel };
}
module.exports = { createWindowTools };
