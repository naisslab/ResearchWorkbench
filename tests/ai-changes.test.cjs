const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { atomicWrite } = require("../electron/core.cjs");
const {
  createChangeStore,
  reviewKey,
  legacyReview,
} = require("../electron/ai-changes.cjs");
const run = promisify(execFile);

test("paper reviews retain run PDFs through collection and reject builds after later edits", async (t) => {
  const f = await fixture(t);
  const { PDFDocument } = require("pdf-lib");
  async function pdf(text) {
    const doc = await PDFDocument.create();
    doc.addPage().drawText(text);
    return Buffer.from(await doc.save());
  }
  const before = await pdf("Original result"),
    after = await pdf("Revised result");
  await f.write("main.tex", "before");
  await f.write(".research-build/main.pdf", before);
  await f.write(".research-build/main.log", "LaTeX Warning: old warning\n");
  const manuscript = { folder: f.folder, mainFile: "main.tex" };
  await f.store.begin(f.id, [f.folder], manuscript);
  const alias = path.join(path.dirname(f.folder), "project-alias");
  await fs.symlink(f.folder, alias);
  assert.deepEqual(
    (
      await require("../electron/paper-snapshot.cjs").paperSnapshot({
        folder: alias,
        mainFile: "main.tex",
      })
    ).bytes,
    before,
  );
  await f.write("main.tex", "after");
  await f.write(".research-build/main.pdf", after);
  await f.store.finish(f.id);
  await f.store.validatePaperBuild(f.id, [f.folder], manuscript);
  await f.store.recordPaperBuild(f.id, {
    ok: false,
    log: "! Build failed\nLaTeX Warning: new warning",
  });
  const restarted = createChangeStore(f.storage);
  await restarted.collect();
  const review = await restarted.paper(f.id);
  assert.deepEqual(review.before.data, before);
  assert.deepEqual(review.after.data, after);
  assert.equal(review.build.ok, false);
  assert.ok(review.build.warnings.includes("LaTeX Warning: new warning"));
  await f.write("main.tex", "later user change");
  await assert.rejects(
    restarted.validatePaperBuild(f.id, [f.folder], manuscript),
    /changed after this run/,
  );
  await assert.rejects(
    restarted.validatePaperBuild(f.id, [f.folder], {
      ...manuscript,
      mainFile: "other.tex",
    }),
    /different manuscript/,
  );
  assert.deepEqual((await restarted.paper(f.id)).after.data, after);
});

async function fixture(t, options) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "research-changes-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = await fs.realpath(directory);
  const folder = path.join(root, "project"),
    storage = path.join(root, "snapshots");
  await fs.mkdir(folder);
  const id = reviewKey("profile", "project", "run");
  const store = createChangeStore(storage, options);
  const write = async (name, bytes) => {
    const file = path.join(folder, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
  };
  return {
    folder,
    storage,
    id,
    store,
    write,
    read: (name) => fs.readFile(path.join(folder, name)),
  };
}

test("reviews command edits and restores exact pre-run files, additions, deletions, binary bytes and executable modes after restart", async (t) => {
  const f = await fixture(t);
  const original = Buffer.from("用户未提交的编辑\r\n第二行\r\n");
  await f.write("draft.tex", original);
  await f.write("removed.txt", "Keep this");
  await f.write("binary.png", Buffer.from([0, 255, 3, 4]));
  await f.write("script.sh", "#!/bin/sh\nexit 0\n");
  await fs.chmod(path.join(f.folder, "script.sh"), 0o755);
  await f.write(".git/HEAD", "original Git history");
  await f.write(".env", "LOCAL_SETTING=before\n");
  await f.store.begin(f.id, [f.folder]);
  await run(
    process.execPath,
    [
      "-e",
      "const fs=require('fs'); fs.writeFileSync('draft.tex','修订后\\n第二行\\n'); fs.unlinkSync('removed.txt'); fs.mkdirSync('new'); fs.writeFileSync('new/added.txt','new file'); fs.writeFileSync('binary.png',Buffer.from([0,1,2])); fs.chmodSync('script.sh',0o644); fs.writeFileSync('.git/HEAD','unrelated Git history'); fs.writeFileSync('.env','LOCAL_SETTING=after\\n');",
    ],
    { cwd: f.folder },
  );
  assert.equal((await f.store.finish(f.id)).files, 6);
  const restarted = createChangeStore(f.storage);
  const review = await restarted.review(f.id, [f.folder]);
  assert.equal(review.canRevert, true);
  const draft = await restarted.file(
    f.id,
    review.files.find((file) => file.path === "draft.tex").id,
  );
  assert.equal(draft.before, original.toString());
  assert.equal(draft.after, "修订后\n第二行\n");
  assert.match(draft.diff, /@@/);
  assert.match(draft.diff, /-用户未提交的编辑/);
  assert.match(draft.diff, /\+修订后/);
  const binary = await restarted.file(
    f.id,
    review.files.find((file) => file.path === "binary.png").id,
  );
  assert.equal(binary.binary, true);
  const result = await restarted.revert(f.id, [f.folder]);
  assert.ok(result.revertedAt);
  assert.deepEqual(await f.read("draft.tex"), original);
  assert.equal((await f.read("removed.txt")).toString(), "Keep this");
  assert.deepEqual(await f.read("binary.png"), Buffer.from([0, 255, 3, 4]));
  assert.equal(
    (await fs.stat(path.join(f.folder, "script.sh"))).mode & 0o777,
    0o755,
  );
  assert.equal((await f.read(".env")).toString(), "LOCAL_SETTING=before\n");
  await assert.rejects(fs.access(path.join(f.folder, "new")), {
    code: "ENOENT",
  });
  assert.equal((await f.read(".git/HEAD")).toString(), "unrelated Git history");
  assert.equal((await restarted.review(f.id, [f.folder])).canRevert, false);
  await assert.rejects(restarted.revert(f.id, [f.folder]), {
    code: "revert_blocked",
  });
  assert.equal((await restarted.file(f.id, draft.id)).after, draft.after);
});

test("refuses the whole revert when a user makes a later edit, preserving every other changed file", async (t) => {
  const f = await fixture(t);
  await f.write("first.txt", "before");
  await f.write("second.txt", "before");
  await f.store.begin(f.id, [f.folder]);
  await f.write("first.txt", "after");
  await f.write("second.txt", "after");
  await f.store.finish(f.id);
  await f.write("second.txt", "later user edit");
  assert.match(
    (await f.store.review(f.id, [f.folder])).reason,
    /changed after this run/,
  );
  await assert.rejects(f.store.revert(f.id, [f.folder]), {
    code: "revert_blocked",
  });
  assert.equal((await f.read("first.txt")).toString(), "after");
  assert.equal((await f.read("second.txt")).toString(), "later user edit");
});

test("handles attached roots and excludes dependency and generated folders", async (t) => {
  const f = await fixture(t);
  const extra = path.join(path.dirname(f.folder), "extra");
  await fs.mkdir(extra);
  await fs.writeFile(path.join(extra, "notes.md"), "before");
  await f.write("nested/draft.tex", "before");
  await f.write("node_modules/package/index.js", "dependency before");
  await f.write(".research-build/main.aux", "build before");
  await f.store.begin(f.id, [f.folder, extra, path.join(f.folder, "nested")]);
  await fs.writeFile(path.join(extra, "notes.md"), "after");
  await f.write("nested/draft.tex", "after");
  await f.write("node_modules/package/index.js", "dependency after");
  await f.write(".research-build/main.aux", "build after");
  assert.equal((await f.store.finish(f.id)).files, 2);
  assert.equal((await f.store.review(f.id, [f.folder])).canRevert, false);
  await f.store.revert(f.id, [f.folder, extra]);
  assert.equal((await f.read("nested/draft.tex")).toString(), "before");
  assert.equal(
    await fs.readFile(path.join(extra, "notes.md"), "utf8"),
    "before",
  );
  assert.equal(
    (await f.read("node_modules/package/index.js")).toString(),
    "dependency after",
  );
  assert.equal(
    (await f.read(".research-build/main.aux")).toString(),
    "build after",
  );
});

test("restores symbolic links themselves and refuses a replaced parent without writing outside the project", async (t) => {
  const f = await fixture(t);
  const outside = path.join(path.dirname(f.folder), "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "text.txt"), "external");
  await f.write("nested/text.txt", "before");
  await fs.symlink("../outside/text.txt", path.join(f.folder, "link"));
  await f.store.begin(f.id, [f.folder]);
  await f.write("nested/text.txt", "after");
  await fs.unlink(path.join(f.folder, "link"));
  await fs.symlink("nested/text.txt", path.join(f.folder, "link"));
  await f.store.finish(f.id);
  await fs.rm(path.join(f.folder, "nested"), { recursive: true });
  await fs.symlink(outside, path.join(f.folder, "nested"));
  await assert.rejects(f.store.revert(f.id, [f.folder]), {
    code: "revert_blocked",
  });
  assert.equal(
    await fs.readFile(path.join(outside, "text.txt"), "utf8"),
    "external",
  );
  await fs.unlink(path.join(f.folder, "nested"));
  await f.write("nested/text.txt", "after");
  await f.store.revert(f.id, [f.folder]);
  assert.equal(
    await fs.readlink(path.join(f.folder, "link")),
    "../outside/text.txt",
  );
  assert.equal(
    await fs.readFile(path.join(outside, "text.txt"), "utf8"),
    "external",
  );
});

test("validates all backups before writing and rejects damaged snapshots", async (t) => {
  const f = await fixture(t);
  await f.write("first.txt", "first before");
  await f.write("second.txt", "second before");
  await f.store.begin(f.id, [f.folder]);
  await f.write("first.txt", "first after");
  await f.write("second.txt", "second after");
  await f.store.finish(f.id);
  const manifest = JSON.parse(
    await fs.readFile(path.join(f.storage, "runs", f.id + ".json")),
  );
  await fs.writeFile(
    path.join(f.storage, "blobs", manifest.changes[1].before.hash),
    "corrupt backup",
  );
  await assert.rejects(f.store.revert(f.id, [f.folder]), /damaged/);
  assert.equal((await f.read("first.txt")).toString(), "first after");
  assert.equal((await f.read("second.txt")).toString(), "second after");
});

test("rolls back a failed restore and allows a subsequent retry", async (t) => {
  let writes = 0;
  const f = await fixture(t, {
    replace: async (...args) => {
      if (++writes === 2) throw new Error("Disk write fixture failed");
      return atomicWrite(...args);
    },
  });
  await f.write("first.txt", "before");
  await f.write("second.txt", "before");
  await f.store.begin(f.id, [f.folder]);
  await f.write("first.txt", "after");
  await f.write("second.txt", "after");
  await f.store.finish(f.id);
  await assert.rejects(f.store.revert(f.id, [f.folder]), {
    code: "revert_failed",
  });
  assert.equal((await f.read("first.txt")).toString(), "after");
  assert.equal((await f.read("second.txt")).toString(), "after");
  await f.store.revert(f.id, [f.folder]);
  assert.equal((await f.read("first.txt")).toString(), "before");
  assert.equal((await f.read("second.txt")).toString(), "before");
});

test("size-limited snapshots remain reviewable and cannot partially revert other files", async (t) => {
  const f = await fixture(t, { maxFileBytes: 8 });
  await f.write("small.txt", "before");
  await f.write("large.txt", "large before");
  await f.store.begin(f.id, [f.folder]);
  await f.write("small.txt", "after");
  await f.write("large.txt", "large after!");
  await f.store.finish(f.id);
  const review = await f.store.review(f.id, [f.folder]);
  assert.equal(review.canRevert, false);
  assert.match(review.reason, /size limit/);
  await assert.rejects(f.store.revert(f.id, [f.folder]), {
    code: "revert_blocked",
  });
  assert.equal((await f.read("small.txt")).toString(), "after");
});
test("an interrupted rollback preserves its journal so a restarted app can safely finish restoring", async (t) => {
  let writes = 0;
  const f = await fixture(t, {
    replace: async (...args) => {
      if ([2, 3].includes(++writes))
        throw new Error("Interrupted disk fixture");
      return atomicWrite(...args);
    },
  });
  await f.write("first.txt", "before");
  await f.write("second.txt", "before");
  await f.store.begin(f.id, [f.folder]);
  await f.write("first.txt", "after");
  await f.write("second.txt", "after");
  await f.store.finish(f.id);
  await assert.rejects(f.store.revert(f.id, [f.folder]), {
    code: "revert_incomplete",
  });
  const restarted = createChangeStore(f.storage);
  assert.equal((await restarted.review(f.id, [f.folder])).canRevert, true);
  await restarted.revert(f.id, [f.folder]);
  assert.equal((await f.read("first.txt")).toString(), "before");
  assert.equal((await f.read("second.txt")).toString(), "before");
});
test("a concurrent edit during restore is preserved while earlier restored files roll back", async (t) => {
  let writes = 0,
    folder;
  const f = await fixture(t, {
    replace: async (...args) => {
      await atomicWrite(...args);
      if (++writes === 1)
        await fs.writeFile(
          path.join(folder, "second.txt"),
          "concurrent user edit",
        );
    },
  });
  folder = f.folder;
  await f.write("first.txt", "before");
  await f.write("second.txt", "before");
  await f.store.begin(f.id, [f.folder]);
  await f.write("first.txt", "after");
  await f.write("second.txt", "after");
  await f.store.finish(f.id);
  await assert.rejects(f.store.revert(f.id, [f.folder]), {
    code: "revert_blocked",
  });
  assert.equal((await f.read("first.txt")).toString(), "after");
  assert.equal((await f.read("second.txt")).toString(), "concurrent user edit");
});

test("interrupted captures and unchanged turns explain why revert is unavailable", async (t) => {
  const f = await fixture(t);
  await f.store.begin(f.id, [f.folder]);
  assert.match(
    (await f.store.review(f.id, [f.folder])).reason,
    /final file versions/,
  );
  await f.store.finish(f.id);
  assert.match(
    (await f.store.review(f.id, [f.folder])).reason,
    /did not change/,
  );
});

test("a run the app never finished is finished at the next launch and stays revertible", async (t) => {
  const f = await fixture(t);
  await f.write("draft.txt", "before");
  await f.store.begin(f.id, [f.folder]);
  await f.write("draft.txt", "agent edit");
  // The app quits before finish; the record is older than any grace period.
  const stale = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await fs.utimes(path.join(f.storage, "runs", f.id + ".json"), stale, stale);
  const restarted = createChangeStore(f.storage);
  await restarted.collect();
  assert.deepEqual(await restarted.summary(f.id), {
    files: 1,
    interrupted: true,
  });
  const review = await restarted.review(f.id, [f.folder]);
  assert.equal(review.canRevert, true);
  assert.equal(review.interrupted, true);
  assert.match(review.warnings[0], /app closed before this run finished/);
  await restarted.revert(f.id, [f.folder]);
  assert.equal((await f.read("draft.txt")).toString(), "before");
});

test("older multi-file patches are reviewable without inventing original file versions", () => {
  const { files, review } = legacyReview({
    diff:
      "diff --git a/one.tex b/one.tex\n--- a/one.tex\n+++ b/one.tex\n@@ -1 +1 @@\n-old\n+new\n" +
      "diff --git a/two.tex b/two.tex\n--- a/two.tex\n+++ /dev/null\n@@ -1 +0,0 @@\n-deleted\n",
  });
  assert.deepEqual(
    files.map((file) => file.path),
    ["one.tex", "two.tex"],
  );
  assert.equal(files[1].kind, "deleted");
  assert.equal(files[0].snapshot, false);
  assert.equal(review.canRevert, false);
  assert.match(review.reason, /older run/);
});
test("unchanged files are not read again, and recent edits are never trusted to the cache", async (t) => {
  const f = await fixture(t);
  await f.write("stable.txt", "stable");
  await f.write("draft.txt", "before");
  const old = new Date(Date.now() - 60000);
  for (const name of ["stable.txt", "draft.txt"])
    await fs.utimes(path.join(f.folder, name), old, old);
  await f.store.begin(f.id, [f.folder]);
  const opened = [];
  const open = fs.open;
  fs.open = async (file, ...rest) => {
    opened.push(path.basename(String(file)));
    return open(file, ...rest);
  };
  t.after(() => (fs.open = open));
  await f.write("draft.txt", "after");
  assert.equal((await f.store.finish(f.id)).files, 1);
  fs.open = open;
  assert.deepEqual(opened, ["draft.txt"]);
  await f.store.revert(f.id, [f.folder]);
  assert.equal((await f.read("draft.txt")).toString(), "before");
});
test("a file that keeps changing does not stop the run and disables only automatic revert", async (t) => {
  const f = await fixture(t);
  await f.write("log.txt", "start");
  const open = fs.open;
  t.after(() => (fs.open = open));
  // Every read sees the file grow, as an experiment log would.
  fs.open = async (file, ...rest) => {
    const handle = await open(file, ...rest);
    if (!String(file).endsWith("log.txt")) return handle;
    const readFile = handle.readFile.bind(handle);
    handle.readFile = async () => {
      const bytes = await readFile();
      await fs.appendFile(file, "+");
      return bytes;
    };
    return handle;
  };
  await f.store.begin(f.id, [f.folder]);
  fs.open = open;
  await f.write("log.txt", "finished");
  await f.store.finish(f.id);
  const review = await f.store.review(f.id, [f.folder]);
  assert.equal(review.canRevert, false);
  assert.match(review.reason, /^log\.txt: This file kept changing/);
});
test("collecting keeps versions that reviews need and removes the rest", async (t) => {
  const f = await fixture(t);
  await f.write("draft.txt", "before");
  await f.write("untouched.txt", "same");
  await f.store.begin(f.id, [f.folder]);
  await f.write("draft.txt", "after");
  await f.store.finish(f.id);
  // A crashed run whose folder is gone can no longer be finished.
  const unfinished = reviewKey("profile", "project", "crashed");
  const gone = path.join(path.dirname(f.folder), "gone");
  await fs.mkdir(gone);
  await f.store.begin(unfinished, [gone]);
  await fs.rm(gone, { recursive: true });
  const stale = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await fs.utimes(
    path.join(f.storage, "runs", unfinished + ".json"),
    stale,
    stale,
  );
  const restarted = createChangeStore(f.storage);
  await restarted.collect();
  assert.deepEqual(await fs.readdir(path.join(f.storage, "runs")), [
    f.id + ".json",
  ]);
  const manifest = JSON.parse(
    await fs.readFile(path.join(f.storage, "runs", f.id + ".json")),
  );
  assert.equal(manifest.before, undefined);
  assert.deepEqual(
    (await fs.readdir(path.join(f.storage, "blobs"))).sort(),
    [manifest.changes[0].before.hash, manifest.changes[0].after.hash].sort(),
  );
  await restarted.revert(f.id, [f.folder]);
  assert.equal((await f.read("draft.txt")).toString(), "before");
  await restarted.discard([f.id]);
  await restarted.collect();
  assert.deepEqual(await fs.readdir(path.join(f.storage, "blobs")), []);
});
test("an unreadable run record stops collection before any version is deleted", async (t) => {
  const f = await fixture(t);
  await f.write("draft.txt", "before");
  await f.store.begin(f.id, [f.folder]);
  await f.write("draft.txt", "after");
  await f.store.finish(f.id);
  const blobs = (await fs.readdir(path.join(f.storage, "blobs"))).sort();
  await fs.writeFile(
    path.join(f.storage, "runs", reviewKey("p", "q", "damaged") + ".json"),
    "{ truncated",
  );
  await assert.rejects(createChangeStore(f.storage).collect());
  assert.deepEqual(
    (await fs.readdir(path.join(f.storage, "blobs"))).sort(),
    blobs,
  );
});
test("after a restart, collected stores still skip unchanged files and keep their versions", async (t) => {
  const f = await fixture(t);
  await f.write("stable.txt", "stable");
  await f.write("draft.txt", "before");
  const old = new Date(Date.now() - 60000);
  for (const name of ["stable.txt", "draft.txt"])
    await fs.utimes(path.join(f.folder, name), old, old);
  await f.store.begin(f.id, [f.folder]);
  await f.write("draft.txt", "after");
  await f.store.finish(f.id);
  const restarted = createChangeStore(f.storage);
  await restarted.collect();
  const opened = [];
  const open = fs.open;
  t.after(() => (fs.open = open));
  fs.open = async (file, ...rest) => {
    opened.push(path.basename(String(file)));
    return open(file, ...rest);
  };
  const next = reviewKey("profile", "project", "next");
  await restarted.begin(next, [f.folder]);
  fs.open = open;
  // draft.txt changed moments ago, so only it is read again.
  assert.deepEqual(opened, ["draft.txt"]);
  await f.write("stable.txt", "edited by the agent");
  await restarted.finish(next);
  await restarted.revert(next, [f.folder]);
  assert.equal((await f.read("stable.txt")).toString(), "stable");
});

test("partial revert preserves unselected later edits and completes the remainder after restart", async (t) => {
  const f = await fixture(t);
  await f.write("intro.tex", "original intro");
  await f.write("eval.tex", "original eval");
  await f.store.begin(f.id, [f.folder]);
  await f.write("intro.tex", "agent intro");
  await f.write("eval.tex", "agent eval");
  await f.store.finish(f.id);
  await f.write("eval.tex", "my later eval");
  const review = await f.store.review(f.id, [f.folder]);
  const intro = review.files.find((f) => f.path === "intro.tex");
  const evaluation = review.files.find((f) => f.path === "eval.tex");
  assert.equal(review.canRevert, false);
  assert.equal(intro.canRevert, true);
  assert.equal(evaluation.canRevert, false);
  const result = await f.store.revert(f.id, [f.folder], [intro.id]);
  assert.equal(result.revertedAt, undefined);
  assert.equal(result.revertedFiles, 1);
  assert.equal((await f.read("intro.tex")).toString(), "original intro");
  assert.equal((await f.read("eval.tex")).toString(), "my later eval");
  await assert.rejects(
    f.store.revert(f.id, [f.folder], [intro.id]),
    /already been reverted/,
  );
  const restarted = createChangeStore(f.storage);
  assert.ok(
    (await restarted.review(f.id, [f.folder])).files.find(
      (f) => f.id === intro.id,
    ).revertedAt,
  );
  await f.write("eval.tex", "agent eval");
  assert.ok((await restarted.revert(f.id, [f.folder])).revertedAt);
  assert.equal((await f.read("eval.tex")).toString(), "original eval");
});

test("invalid partial selections never change files and a failed partial revert keeps earlier reversions", async (t) => {
  let fail = false;
  const f = await fixture(t, {
    replace: async (target, bytes, options) => {
      if (fail && target.endsWith("b.tex")) throw new Error("disk full");
      return atomicWrite(target, bytes, options);
    },
  });
  for (const file of ["a.tex", "b.tex", "c.tex"]) await f.write(file, "before");
  await f.store.begin(f.id, [f.folder]);
  for (const file of ["a.tex", "b.tex", "c.tex"]) await f.write(file, "after");
  await f.store.finish(f.id);
  const review = await f.store.review(f.id, [f.folder]);
  const ids = Object.fromEntries(review.files.map((f) => [f.path, f.id]));
  for (const list of [[], ["missing"], [ids["a.tex"], ids["a.tex"]]])
    await assert.rejects(f.store.revert(f.id, [f.folder], list));
  await f.store.revert(f.id, [f.folder], [ids["c.tex"]]);
  fail = true;
  await assert.rejects(
    f.store.revert(f.id, [f.folder], [ids["a.tex"], ids["b.tex"]]),
  );
  assert.equal((await f.read("a.tex")).toString(), "after");
  assert.equal((await f.read("c.tex")).toString(), "before");
  fail = false;
  await f.store.revert(f.id, [f.folder]);
  assert.equal((await f.read("b.tex")).toString(), "before");
});
