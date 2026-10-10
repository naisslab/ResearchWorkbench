const { Worker } = require("node:worker_threads");
const fs = require("node:fs/promises");
const path = require("node:path");
function createSearch({ directory, workspace, ai, emit }) {
  let worker, pending;
  const stop = () => {
    pending?.resolve({
      results: [],
      warnings: [],
      scanned: 0,
      cancelled: true,
    });
    pending = null;
    worker?.postMessage({ cancel: true });
  };
  return {
    cancel: stop,
    async search(query, id) {
      if (
        typeof query !== "string" ||
        query.trim().length < 2 ||
        query.length > 200 ||
        typeof id !== "string"
      )
        throw new Error("Enter 2–200 characters to search.");
      stop();
      if (!worker) {
        worker = new Worker(path.join(__dirname, "search-worker.cjs"));
        worker.on("message", (packet) => {
          if (!pending || packet.id !== pending.id) return;
          if (packet.error) {
            pending.reject(new Error(packet.error));
            pending = null;
          } else if (packet.partial) emit(packet);
          else {
            pending.resolve(packet);
            pending = null;
          }
        });
        worker.on("error", (error) => {
          pending?.reject(error);
          pending = null;
          worker = null;
        });
        worker.on("exit", () => {
          pending?.reject(new Error("Search stopped. Try again."));
          pending = null;
          worker = null;
        });
      }
      return new Promise((resolve, reject) => {
        pending = { id, resolve, reject };
        void (async () => {
          const projects = workspace().projects;
          const archives = [],
            chats = [],
            initialWarnings = [];
          const folder = path.join(directory, "pdf-annotations");
          for (const name of await fs.readdir(folder).catch(() => [])) {
            if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
            try {
              const record = JSON.parse(
                await fs.readFile(path.join(folder, name), "utf8"),
              );
              if (projects.some((p) => p.id === record.projectId))
                archives.push({
                  ...record,
                  file: path.join(folder, name.replace(/json$/, "pdf")),
                });
            } catch {
              initialWarnings.push(`Could not read saved annotations: ${name}`);
            }
          }
          for (const project of projects) {
            try {
              for (const chat of await ai().searchChats(project.id))
                chats.push({ ...chat, projectId: project.id });
            } catch {
              initialWarnings.push(
                `Conversation history unavailable: ${project.name}`,
              );
            }
          }
          if (pending?.id === id)
            worker.postMessage({
              id,
              query,
              projects,
              archives,
              chats,
              initialWarnings,
            });
        })().catch((error) => {
          if (pending?.id === id) {
            pending.reject(error);
            pending = null;
          }
        });
      });
    },
    dispose() {
      stop();
      return worker?.terminate();
    },
  };
}
module.exports = { createSearch };
