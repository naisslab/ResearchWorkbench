const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const { execFile } = require("node:child_process");
const run = promisify(execFile);
const git = require("../electron/git.cjs");
async function command(folder, args) {
  return (await run("/usr/bin/git", ["-C", folder, ...args])).stdout.trim();
}
test("Git connects, commits, pushes and pulls real repositories, preserving dirty and divergent work", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "research-git-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const local = path.join(root, "local"),
    remote = path.join(root, "remote.git"),
    peer = path.join(root, "peer");
  await fs.mkdir(local);
  await fs.mkdir(remote);
  await command(remote, ["init", "--bare", "--initial-branch=main"]);
  assert.equal((await git.status(local)).connected, false);
  await assert.rejects(git.connect(local, "-oBad"), /URL/);
  await git.connect(local, remote);
  await command(local, ["config", "user.name", "Research Test"]);
  await command(local, ["config", "user.email", "research@example.com"]);
  await fs.writeFile(path.join(local, "main.tex"), "First draft\n");
  await fs.mkdir(path.join(local, ".research-build"));
  await fs.writeFile(
    path.join(local, ".research-build", "main.pdf"),
    "Generated output",
  );
  assert.deepEqual(
    (await git.status(local)).changes.map((c) => c.file),
    ["main.tex"],
  );
  await assert.rejects(git.sync(local), /Commit or stash/);
  await git.commit(local, "Initial draft");
  await git.sync(local);
  assert.deepEqual((await git.status(local)).changes, []);
  assert.equal(await command(local, ["ls-files", ".research-build"]), "");
  await run("/usr/bin/git", ["clone", remote, peer]);
  await command(peer, ["config", "user.name", "Research Peer"]);
  await command(peer, ["config", "user.email", "peer@example.com"]);
  await fs.writeFile(path.join(peer, "main.tex"), "Peer revision\n");
  await command(peer, ["commit", "-am", "Peer revision"]);
  await command(peer, ["push"]);
  await git.sync(local, "pull");
  assert.equal(
    await fs.readFile(path.join(local, "main.tex"), "utf8"),
    "Peer revision\n",
  );
  await fs.writeFile(path.join(local, "main.tex"), "Local divergent work\n");
  await git.commit(local, "Local work");
  await fs.writeFile(path.join(peer, "main.tex"), "Peer divergent work\n");
  await command(peer, ["commit", "-am", "Peer work"]);
  await command(peer, ["push"]);
  await assert.rejects(git.sync(local), /fast-forward|diverging/);
  assert.equal(
    await fs.readFile(path.join(local, "main.tex"), "utf8"),
    "Local divergent work\n",
  );
  // Different local and remote branch names must preserve the configured upstream.
  await command(local, ["checkout", "-b", "local-draft"]);
  await command(local, ["branch", "--set-upstream-to=origin/main"]);
  assert.equal((await git.status(local)).remoteBranch, "main");
});

test("Selective commits preserve other staged changes and preview literal paths and renames", async (t) => {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "research-git-review-"),
  );
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await git.init(folder);
  await command(folder, ["config", "user.name", "Review Test"]);
  await command(folder, ["config", "user.email", "review@example.com"]);
  const unusual = "[draft] notes.tex";
  await fs.writeFile(path.join(folder, unusual), "Original draft\n");
  await fs.writeFile(path.join(folder, "references.bib"), "First references\n");
  const newPreview = await git.diff(folder, unusual);
  assert.match(newPreview.text, /\+Original draft/);
  await git.commit(folder, "Initial checkpoint");
  await fs.writeFile(path.join(folder, unusual), "Revised draft\n");
  await fs.writeFile(
    path.join(folder, "references.bib"),
    "Revised references\n",
  );
  await command(folder, ["add", "references.bib"]);
  const preview = await git.diff(folder, unusual);
  assert.match(preview.text, /-Original draft/);
  assert.match(preview.text, /\+Revised draft/);
  await assert.rejects(
    git.commit(folder, "Empty selection", []),
    /Select changed/,
  );
  await assert.rejects(
    git.commit(folder, "Invalid selection", ["../outside"]),
    /Select changed/,
  );
  await git.commit(folder, "Only manuscript", [unusual]);
  assert.equal(
    await command(folder, ["show", "HEAD:references.bib"]),
    "First references",
  );
  assert.equal(
    await command(folder, ["diff", "--cached", "--name-only"]),
    "references.bib",
  );
  const current = await git.status(folder);
  assert.equal(current.history[0].subject, "Only manuscript");
  assert.equal(current.changes.length, 1);
  await command(folder, ["mv", unusual, "renamed.tex"]);
  await git.commit(folder, "Rename manuscript", ["renamed.tex"]);
  assert.equal(await command(folder, ["ls-files", unusual]), "");
  assert.equal(
    await command(folder, ["show", "HEAD:renamed.tex"]),
    "Revised draft",
  );
  assert.equal(
    await command(folder, ["diff", "--cached", "--name-only"]),
    "references.bib",
  );
  await fs.symlink("/etc/hosts", path.join(folder, "external-link"));
  assert.match(
    (await git.diff(folder, "external-link")).text,
    /^Symbolic link/,
  );
  await fs.writeFile(path.join(folder, "asset.bin"), Buffer.from([1, 0, 2]));
  assert.match((await git.diff(folder, "asset.bin")).text, /^Binary file/);
  await assert.rejects(git.diff(folder, "../outside"), /no longer changed/);
  await command(folder, ["rm", "renamed.tex"]);
  await git.commit(folder, "Remove manuscript", ["renamed.tex"]);
  assert.equal(await command(folder, ["ls-files", "renamed.tex"]), "");
  assert.equal(
    await command(folder, ["diff", "--cached", "--name-only"]),
    "references.bib",
  );
});

test("Fetch checks remote changes without altering dirty files or requiring an upstream", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "research-git-fetch-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const local = path.join(root, "local"),
    remote = path.join(root, "remote.git"),
    peer = path.join(root, "peer");
  await fs.mkdir(local);
  await fs.mkdir(remote);
  await command(remote, ["init", "--bare", "--initial-branch=main"]);
  await git.connect(local, remote);
  await command(local, ["config", "user.name", "Fetch Test"]);
  await command(local, ["config", "user.email", "fetch@example.com"]);
  await fs.writeFile(path.join(local, "paper.tex"), "Draft\n");
  await git.commit(local, "Initial draft");
  assert.equal((await git.status(local)).ahead, 1);
  await git.sync(local, "push");
  await run("/usr/bin/git", ["clone", remote, peer]);
  await command(peer, ["config", "user.name", "Peer"]);
  await command(peer, ["config", "user.email", "peer@example.com"]);
  await fs.writeFile(path.join(peer, "paper.tex"), "Remote revision\n");
  await command(peer, ["commit", "-am", "Remote revision"]);
  await command(peer, ["push"]);
  await command(local, ["branch", "--unset-upstream"]);
  await fs.writeFile(path.join(local, "paper.tex"), "Unsaved local research\n");
  const checked = await git.sync(local, "fetch");
  assert.equal(checked.behind, 1);
  assert.equal(checked.hasRemoteBranch, true);
  assert.equal(
    await fs.readFile(path.join(local, "paper.tex"), "utf8"),
    "Unsaved local research\n",
  );
  await git.commit(local, "Local revision");
  const divergent = await git.status(local);
  assert.equal(divergent.ahead, 1);
  assert.equal(divergent.behind, 1);
});
