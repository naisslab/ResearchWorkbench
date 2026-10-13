const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createDraftStore } = require("../electron/editor-drafts.cjs");

test("drafts survive restart, remain isolated by project and root, and never write the manuscript", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "drafts-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const manuscript = path.join(dir, "main.tex");
  await fs.writeFile(manuscript, "on disk");
  const store = createDraftStore(path.join(dir, "drafts"));
  await store.write("one", "primary", "main.tex", dir, {
    text: "unsaved 中文",
    base: "on disk",
  });
  await store.write("two", "primary", "main.tex", dir, {
    text: "other project",
    base: "on disk",
  });
  const restarted = createDraftStore(path.join(dir, "drafts"));
  assert.equal(
    (await restarted.read("one", "primary", "main.tex", dir)).text,
    "unsaved 中文",
  );
  assert.equal(
    (await restarted.read("two", "primary", "main.tex", dir)).text,
    "other project",
  );
  assert.equal(await restarted.read("one", "code", "main.tex", dir), null);
  assert.equal(
    await restarted.read("one", "primary", "main.tex", dir + "-moved"),
    null,
  );
  assert.equal(await fs.readFile(manuscript, "utf8"), "on disk");
  const writes = [
    store.write("one", "primary", "main.tex", dir, {
      text: "pending",
      base: "on disk",
    }),
    store.write("one", "primary", "main.tex", dir, null),
  ];
  await Promise.all(writes);
  assert.equal(await store.read("one", "primary", "main.tex", dir), null);
  await assert.rejects(
    store.write("one", "primary", "main.tex", dir, {
      text: "x".repeat(2097153),
      base: "",
    }),
    /2 MB/,
  );
});

test("reattaching a project preserves drafts for each directory, including legacy records", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "draft-roots-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createDraftStore(dir);
  const file = path.join(
    dir,
    require("node:crypto")
      .createHash("sha256")
      .update(JSON.stringify(["project", "primary", "main.tex"]))
      .digest("hex") + ".json",
  );
  await fs.writeFile(
    file,
    JSON.stringify({
      root: "/old",
      file: "main.tex",
      text: "old draft",
      base: "original",
    }),
  );
  assert.equal(
    await store.read("project", "primary", "main.tex", "/new"),
    null,
  );
  await store.write("project", "primary", "main.tex", "/new", null);
  assert.equal(
    (await store.read("project", "primary", "main.tex", "/old")).text,
    "old draft",
  );
  await store.write("project", "primary", "main.tex", "/new", {
    text: "new draft",
    base: "new original",
  });
  const restarted = createDraftStore(dir);
  assert.equal(
    (await restarted.read("project", "primary", "main.tex", "/old")).text,
    "old draft",
  );
  assert.equal(
    (await restarted.read("project", "primary", "main.tex", "/new")).text,
    "new draft",
  );
  await restarted.write("project", "primary", "main.tex", "/old", null);
  assert.equal(
    (await restarted.read("project", "primary", "main.tex", "/new")).text,
    "new draft",
  );
});

test("repository draft guards include other project aliases and ignore saved or unrelated drafts", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "draft-guard-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, "manuscript"),
    other = path.join(dir, "other");
  await fs.mkdir(root);
  await fs.mkdir(other);
  await fs.writeFile(path.join(root, "main.tex"), "saved");
  const store = createDraftStore(path.join(dir, "drafts"));
  await store.write("other-project-alias", "primary", "main.tex", root, {
    text: "unsaved",
    base: "saved",
  });
  await store.write("unrelated", "primary", "notes.tex", other, {
    text: "unsaved",
    base: "",
  });
  assert.deepEqual(await store.pendingIn(root), ["main.tex"]);
  await fs.writeFile(path.join(root, "main.tex"), "unsaved");
  assert.deepEqual(await store.pendingIn(root), []);
  await store.write("other-project-alias", "primary", "main.tex", root, null);
  assert.deepEqual(await store.pendingIn(root), []);
});
