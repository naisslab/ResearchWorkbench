const test = require("node:test");
const assert = require("node:assert/strict");
test("damaged preferences retain usable entries without invalid PDF or cursor positions", async () => {
  const { readSessions } = await import("../src/workbench-state.ts");
  const result = readSessions(
    JSON.stringify([
      null,
      ["bad", null],
      [
        "project",
        {
          file: "main.tex",
          anchor: -3,
          head: 4,
          recent: [null, { file: 7 }, { rootId: "primary", file: "main.tex" }],
          pdfs: {
            broken: null,
            valid: { page: 3, zoom: 99, offset: -1, showNotes: false },
          },
        },
      ],
    ]),
  );
  assert.equal(result.size, 1);
  const session = result.get("project");
  assert.equal(session.rootId, "primary");
  assert.equal(session.anchor, undefined);
  assert.equal(session.head, 4);
  assert.deepEqual(session.recent, [{ rootId: "primary", file: "main.tex" }]);
  assert.equal(session.pdfs.broken, undefined);
  assert.deepEqual(session.pdfs.valid, {
    page: 3,
    zoom: 2.5,
    offset: 0,
    showNotes: false,
  });
  assert.equal(readSessions("invalid json").size, 0);
});
test("legacy drafts migrate once and cannot return after sending", async () => {
  const { readChatDraft } = await import("../src/workbench-state.ts");
  const data = new Map([["legacy", "old draft"]]);
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
  assert.equal(readChatDraft(storage, "chat", "legacy"), "old draft");
  storage.removeItem("chat");
  assert.equal(readChatDraft(storage, "chat", "legacy"), "");
  storage.setItem("legacy", "obsolete");
  storage.setItem("chat", "new draft");
  assert.equal(readChatDraft(storage, "chat", "legacy"), "new draft");
  assert.equal(storage.getItem("legacy"), null);
});
