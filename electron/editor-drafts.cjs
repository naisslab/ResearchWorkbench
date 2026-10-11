const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { protectedWrite } = require("./chatgpt.cjs");
const { createTaskQueue } = require("./task-queue.cjs");

function createDraftStore(directory) {
  const queue = createTaskQueue();
  const key = (id, rootId, file) =>
    crypto
      .createHash("sha256")
      .update(JSON.stringify([id, rootId || "primary", file]))
      .digest("hex");
  const target = (id, rootId, file) =>
    path.join(directory, key(id, rootId, file) + ".json");
  // Keep directory identities in the record so backup restoration can remap
  // them. A project can be attached to several directories over its lifetime.
  async function versions(location) {
    const value = await fs
      .readFile(location, "utf8")
      .then(JSON.parse)
      .catch((e) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
    if (!value) return [];
    const items = value.drafts ?? [value]; // Read the original single-copy format.
    if (
      !Array.isArray(items) ||
      items.some(
        (item) =>
          !item ||
          typeof item.root !== "string" ||
          typeof item.text !== "string" ||
          typeof item.base !== "string",
      )
    )
      throw new Error(
        "The recovery draft could not be read. Its saved copy was preserved.",
      );
    return items;
  }
  const read = (id, rootId, file, root) =>
    queue(async () => {
      return (
        (await versions(target(id, rootId, file))).find(
          (draft) => draft.root === root,
        ) || null
      );
    });
  const write = (id, rootId, file, root, draft) =>
    queue(async () => {
      const location = target(id, rootId, file);
      if (
        draft !== null &&
        (!draft ||
          [draft.text, draft.base].some(
            (s) =>
              typeof s !== "string" || Buffer.byteLength(s) > 2 * 1024 * 1024,
          ))
      )
        throw new Error("Recovery drafts support files up to 2 MB.");
      const items = (await versions(location)).filter(
        (item) => item.root !== root,
      );
      if (draft)
        items.push({
          root,
          file,
          text: draft.text,
          base: draft.base,
          updatedAt: new Date().toISOString(),
        });
      if (items.length)
        await protectedWrite(location, JSON.stringify({ drafts: items }));
      else await fs.rm(location, { force: true });
    });
  return { read, write, flush: queue.settled };
}
module.exports = { createDraftStore };
