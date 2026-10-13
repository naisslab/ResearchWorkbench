const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const execute = promisify(require("node:child_process").execFile);
const {
  createOverleaf,
  parseOverleafUrl,
} = require("../electron/overleaf.cjs");
const {
  createTokenStore,
  withOverleafCredential,
} = require("../electron/overleaf-auth.cjs");
const { createGitRunner } = require("../electron/git-runner.cjs");
const url = "https://www.overleaf.com/project/0123456789abcdef01234567";
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (s) =>
    Buffer.from(`encrypted:${Buffer.from(s).toString("base64")}`),
  decryptString: (b) =>
    Buffer.from(b.toString().slice(10), "base64").toString(),
};
const command = async (folder, ...args) =>
  (await execute("git", ["-C", folder, ...args])).stdout.trim();
async function fixture(t, branch = "main") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "research-overleaf-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const remote = path.join(root, "remote.git"),
    peer = path.join(root, "peer"),
    local = path.join(root, "local"),
    directory = path.join(root, "state");
  await fs.mkdir(remote);
  await fs.mkdir(peer);
  await command(remote, "init", "--bare", `--initial-branch=${branch}`);
  await command(peer, "init", `--initial-branch=${branch}`);
  await command(peer, "config", "user.name", "Coauthor");
  await command(peer, "config", "user.email", "coauthor@example.test");
  await fs.writeFile(
    path.join(peer, "paper.tex"),
    "Title\n\nOriginal paragraph.\n",
  );
  await fs.writeFile(
    path.join(peer, "references.bib"),
    "Original references.\n",
  );
  await command(peer, "add", ".");
  await command(peer, "commit", "-m", "Initial draft");
  await command(peer, "remote", "add", "origin", remote);
  await command(peer, "push", "-u", "origin", branch);
  const requests = [];
  let failAfterPush = false;
  const transport = async ({
    folder,
    args,
    connection,
    token,
    git,
    options,
  }) => {
    assert.equal(token, "test-secret-token");
    assert.equal("credentialRef" in connection, false);
    requests.push(args);
    const result = await git.run(
      folder,
      args.map((arg) => (arg === connection.gitUrl ? remote : arg)),
      [],
      {},
      options,
    );
    if (args[0] === "push" && failAfterPush) {
      failAfterPush = false;
      throw new Error("Connection closed after request");
    }
    return result;
  };
  const options = { directory, encryption, transport };
  const api = createOverleaf(options);
  await api.connect({
    projectId: "paper",
    folder: local,
    url,
    token: "test-secret-token",
    clone: true,
  });
  await command(local, "config", "user.name", "Researcher");
  await command(local, "config", "user.email", "researcher@example.test");
  return {
    root,
    remote,
    peer,
    local,
    directory,
    api,
    options,
    requests,
    branch,
    failNextPushResponse: () => {
      failAfterPush = true;
    },
  };
}
async function commit(folder, file, text, message) {
  await fs.writeFile(path.join(folder, file), text);
  await command(folder, "add", "--", file);
  await command(folder, "commit", "-m", message);
}
async function approve(api, review) {
  await api.recordCompile("paper", review.id, {
    ok: true,
    reviewToken: review.reviewToken,
    message: "Fixture compile passed",
  });
  return api.apply("paper", review.id, {
    expectedHead: review.baseHead,
    expectedRemoteHead: review.remoteHead,
    reviewToken: review.reviewToken,
  });
}
const publishOptions = (tx) => ({
  expectedHead: tx.resultHead,
  expectedRemoteHead: tx.remoteHead,
  acknowledgeReviewDataLoss: true,
});

test("Overleaf URLs accept project and Git forms while excluding token-bearing and lookalike hosts", () => {
  for (const input of [
    url,
    "https://git.overleaf.com/0123456789abcdef01234567",
    "https://git@git.overleaf.com/0123456789abcdef01234567",
  ])
    assert.equal(
      parseOverleafUrl(input).gitUrl,
      "https://git.overleaf.com/0123456789abcdef01234567",
    );
  for (const input of [
    "https://overleaf.com.evil.test/project/0123456789abcdef01234567",
    "https://git:secret@git.overleaf.com/0123456789abcdef01234567",
    "http://git.overleaf.com/0123456789abcdef01234567",
    `${url}?token=secret`,
    `${url}/extra`,
  ])
    assert.throws(() => parseOverleafUrl(input));
});

test("Credentials require OS encryption and never appear in Git argv or returned errors", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "research-overleaf-auth-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(
    createTokenStore(root, { isEncryptionAvailable: () => false }).put(
      "secret",
    ),
    /unavailable/,
  );
  await assert.rejects(
    createTokenStore(root, {
      ...encryption,
      getSelectedStorageBackend: () => "basic_text",
    }).put("secret"),
    /unavailable/,
  );
  const store = createTokenStore(root, encryption),
    reference = await store.put("secret");
  assert.equal(await store.get(reference), "secret");
  assert.equal(
    (await fs.readFile(path.join(root, `${reference}.bin`), "utf8")).includes(
      "secret",
    ),
    false,
  );
  const git = {
    run: async (folder, args, config, env) => {
      assert.equal(JSON.stringify([args, config]).includes("secret"), false);
      assert.match(env.GIT_CONFIG_VALUE_0, /^Authorization: Basic /);
      assert.equal(env.GIT_TRACE_CURL, "0");
      throw new Error(`secret ${Buffer.from("git:secret").toString("base64")}`);
    },
  };
  await assert.rejects(
    withOverleafCredential(
      git,
      root,
      ["fetch"],
      parseOverleafUrl(url),
      "secret",
      { resolveProxy: async () => "DIRECT" },
    ),
    (error) =>
      !error.message.includes("secret") && !error.message.includes("Z2l0"),
  );
  const header = await withOverleafCredential(
    createGitRunner(),
    root,
    [
      "config",
      "--get-urlmatch",
      "http.extraHeader",
      parseOverleafUrl(url).gitUrl,
    ],
    parseOverleafUrl(url),
    "secret",
    { resolveProxy: async () => "DIRECT" },
  );
  assert.equal(
    header,
    `Authorization: Basic ${Buffer.from("git:secret").toString("base64")}`,
  );
  const foreignHeader = await withOverleafCredential(
    createGitRunner(),
    root,
    [
      "config",
      "--get-urlmatch",
      "http.extraHeader",
      "https://example.test/0123456789abcdef01234567",
    ],
    parseOverleafUrl(url),
    "secret",
    { resolveProxy: async () => "DIRECT" },
  );
  assert.equal(foreignHeader, "");
  await store.remove(reference);
  await assert.rejects(store.get(reference), /unavailable/);
});

for (const branch of ["main", "master"])
  test(`Clone and fetch discover ${branch}, preserve dirty work, and do not configure a bypass remote`, async (t) => {
    const { api, local, peer, branch: name } = await fixture(t, branch);
    const status = await api.status("paper");
    assert.equal(status.connection.remoteBranch, branch);
    assert.equal(status.connection.mode, "review");
    assert.equal(JSON.stringify(status).includes("credentialRef"), false);
    assert.equal(await command(local, "remote"), "");
    await fs.writeFile(path.join(local, "paper.tex"), "Unsaved local source\n");
    await commit(
      peer,
      "references.bib",
      "Updated references\n",
      "Update bibliography",
    );
    await command(peer, "push", "origin", name);
    assert.equal((await api.check("paper")).behind, 1);
    assert.equal(
      await fs.readFile(path.join(local, "paper.tex"), "utf8"),
      "Unsaved local source\n",
    );
    await assert.rejects(api.plan("paper"), /Save and commit/);
  });

test("Review reconciles concurrent edits in an isolated tree and publishes one linear reviewed commit", async (t) => {
  const { api, local, peer, remote, requests } = await fixture(t);
  await commit(
    local,
    "paper.tex",
    "Title\n\nLocally revised paragraph.\n",
    "Local revision",
  );
  const originalHead = await command(local, "rev-parse", "HEAD");
  await commit(
    peer,
    "references.bib",
    "Coauthor references\n",
    "Coauthor revision",
  );
  await command(peer, "push");
  const review = await api.plan("paper");
  assert.equal(review.stage, "ready");
  assert.equal(
    (await api.status("paper")).transaction.reviewToken,
    review.reviewToken,
  );
  assert.match(review.diff.text, /Locally revised paragraph/);
  assert.equal(await command(local, "rev-parse", "HEAD"), originalHead);
  assert.equal(
    await fs.readFile(path.join(local, "references.bib"), "utf8"),
    "Original references.\n",
  );
  const { folder } = await api.stagingProject("paper", review.id);
  assert.equal(
    await fs.readFile(path.join(folder, "references.bib"), "utf8"),
    "Coauthor references\n",
  );
  await assert.rejects(
    api.apply("paper", review.id, {
      expectedHead: review.baseHead,
      expectedRemoteHead: review.remoteHead,
      reviewToken: "stale",
    }),
    /contents changed/,
  );
  const applied = await approve(api, review);
  assert.equal(await command(local, "rev-parse", "HEAD"), applied.resultHead);
  assert.equal(await command(local, "rev-parse", "HEAD^"), review.remoteHead);
  assert.equal(
    await command(
      local,
      "rev-parse",
      `refs/research-overleaf/checkpoints/${review.id}`,
    ),
    originalHead,
  );
  await assert.rejects(
    api.publish("paper", review.id, publishOptions(applied)),
    /review-only/,
  );
  await api.setMode("paper", "publish");
  await assert.rejects(
    api.publish("paper", review.id, {
      ...publishOptions(applied),
      acknowledgeReviewDataLoss: false,
    }),
    /Acknowledge/,
  );
  await api.publish("paper", review.id, publishOptions(applied));
  assert.equal(
    await command(remote, "rev-parse", "refs/heads/main"),
    applied.resultHead,
  );
  assert.equal(
    requests.some((args) => args.some((arg) => /force/.test(arg))),
    false,
  );
});

test("Three-way conflict choices preserve exact text and restart state, with safe cancellation", async (t) => {
  const { api, options, local, peer } = await fixture(t);
  await commit(local, "paper.tex", "Local text\n\n", "Local");
  await commit(peer, "paper.tex", "Remote text\n", "Remote");
  await command(peer, "push");
  const review = await api.plan("paper");
  assert.equal(review.stage, "conflicts");
  assert.equal(review.conflicts[0].local.text, "Local text\n\n");
  assert.equal(review.conflicts[0].remote.text, "Remote text\n");
  assert.equal(review.conflicts[0].base.text, "Title\n\nOriginal paragraph.\n");
  assert.equal(
    (await createOverleaf(options).review("paper", review.id)).stage,
    "conflicts",
  );
  await assert.rejects(
    api.resolve("paper", review.id, { file: "../outside", choice: "local" }),
    /unresolved file/,
  );
  const resolved = await api.resolve("paper", review.id, {
    file: "paper.tex",
    choice: "text",
    text: "Combined review\n\n",
  });
  assert.equal(resolved.stage, "ready");
  assert.equal(resolved.conflicts.length, 0);
  assert.notEqual(resolved.reviewToken, review.reviewToken);
  assert.equal(
    await fs.readFile(path.join(local, "paper.tex"), "utf8"),
    "Local text\n\n",
  );
  await api.cancel("paper", review.id);
  assert.equal((await api.status("paper")).transaction.stage, "cancelled");
  assert.equal(
    await fs.readFile(path.join(local, "paper.tex"), "utf8"),
    "Local text\n\n",
  );
});

test("Changed local/remote revisions invalidate review and failed compile blocks publication", async (t) => {
  const { api, local, peer } = await fixture(t);
  await commit(local, "paper.tex", "Local revision\n", "Local");
  const review = await api.plan("paper");
  await commit(
    peer,
    "references.bib",
    "New remote references\n",
    "Remote advanced",
  );
  await command(peer, "push");
  await assert.rejects(approve(api, review), /Overleaf changed/);
  await api.cancel("paper", review.id);
  const next = await api.plan("paper");
  await api.recordCompile("paper", next.id, {
    ok: false,
    reviewToken: next.reviewToken,
    message: "Missing package",
  });
  const applied = await api.apply("paper", next.id, {
    expectedHead: next.baseHead,
    expectedRemoteHead: next.remoteHead,
    reviewToken: next.reviewToken,
  });
  await api.setMode("paper", "publish");
  await assert.rejects(
    api.publish("paper", next.id, publishOptions(applied)),
    /Compile/,
  );
  await fs.writeFile(path.join(local, "paper.tex"), "Still typing\n");
  await assert.rejects(
    api.restore("paper", next.id, { expectedHead: applied.resultHead }),
    /Save and commit/,
  );
  assert.equal(
    await fs.readFile(path.join(local, "paper.tex"), "utf8"),
    "Still typing\n",
  );
});

test("An ambiguous successful push is recovered by checking the remote after restart", async (t) => {
  const { api, options, local, failNextPushResponse } = await fixture(t);
  await commit(local, "paper.tex", "Reviewed text\n", "Local");
  const review = await api.plan("paper"),
    applied = await approve(api, review);
  await api.setMode("paper", "publish");
  failNextPushResponse();
  await assert.rejects(
    api.publish("paper", review.id, publishOptions(applied)),
    /confirmed result/,
  );
  assert.equal((await api.status("paper")).transaction.stage, "publishing");
  await assert.rejects(api.cancel("paper", review.id), /pending publish/);
  const restarted = createOverleaf(options);
  assert.equal((await restarted.check("paper")).transaction.stage, "published");
  await assert.rejects(
    restarted.restore("paper", review.id, { expectedHead: applied.resultHead }),
    /unpublished/,
  );
});

test("Reconciliation can restore its local checkpoint without changing Overleaf", async (t) => {
  const { api, local, remote } = await fixture(t);
  await commit(local, "paper.tex", "Local draft\n", "Local");
  const review = await api.plan("paper"),
    applied = await approve(api, review);
  const beforeRemote = await command(remote, "rev-parse", "HEAD");
  await api.restore("paper", review.id, { expectedHead: applied.resultHead });
  assert.equal(await command(local, "rev-parse", "HEAD"), review.baseHead);
  assert.equal(await command(remote, "rev-parse", "HEAD"), beforeRemote);
});

test("Local revisions and exact review content remain guarded across review and compile", async (t) => {
  const { api, local } = await fixture(t);
  await commit(local, "paper.tex", "Local revision\n", "Local");
  const review = await api.plan("paper");
  const { folder } = await api.stagingProject("paper", review.id);
  await fs.appendFile(path.join(folder, "paper.tex"), "External review edit\n");
  await assert.rejects(
    api.recordCompile("paper", review.id, {
      ok: true,
      reviewToken: review.reviewToken,
    }),
    /changed during compilation/,
  );
  await assert.rejects(
    api.apply("paper", review.id, {
      expectedHead: review.baseHead,
      expectedRemoteHead: review.remoteHead,
      reviewToken: review.reviewToken,
    }),
    /contents changed/,
  );
  await api.cancel("paper", review.id);
  const next = await api.plan("paper");
  await commit(
    local,
    "references.bib",
    "New local edit\n",
    "Another local change",
  );
  await assert.rejects(approve(api, next), /local revision changed/);
});

test("Binary and delete/modify conflicts resolve without losing bytes or requiring a terminal", async (t) => {
  const { api, local, peer } = await fixture(t);
  const first = Buffer.from([0, 1, 2, 3]);
  await commit(peer, "figure.bin", first, "Add binary figure");
  await command(peer, "push");
  let review = await api.plan("paper");
  await approve(api, review);
  await api.cancel("paper", review.id);
  await commit(
    local,
    "figure.bin",
    Buffer.from([0, 4, 5, 6]),
    "Revise local figure",
  );
  await command(local, "rm", "references.bib");
  await command(local, "commit", "-m", "Remove local references");
  await commit(
    peer,
    "figure.bin",
    Buffer.from([0, 7, 8, 9]),
    "Revise remote figure",
  );
  await commit(
    peer,
    "references.bib",
    "Remotely revised references\n",
    "Revise remote references",
  );
  await command(peer, "push");
  review = await api.plan("paper");
  assert.equal(review.conflicts.length, 2);
  assert.equal(
    review.conflicts.find((entry) => entry.file === "figure.bin").local.binary,
    true,
  );
  await api.resolve("paper", review.id, {
    file: "figure.bin",
    choice: "remote",
  });
  review = await api.resolve("paper", review.id, {
    file: "references.bib",
    choice: "local",
  });
  await approve(api, review);
  assert.deepEqual(
    await fs.readFile(path.join(local, "figure.bin")),
    Buffer.from([0, 7, 8, 9]),
  );
  await assert.rejects(fs.stat(path.join(local, "references.bib")), {
    code: "ENOENT",
  });
});

test("Restart recovers an interrupted local apply and preserves its checkpoint", async (t) => {
  const { api, options, local, directory } = await fixture(t);
  await commit(local, "paper.tex", "Local revision\n", "Local");
  const review = await api.plan("paper"),
    applied = await approve(api, review);
  const projectFolder = (await fs.readdir(directory)).find(
    (entry) => entry !== "credentials",
  );
  const file = path.join(directory, projectFolder, "transaction.json");
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  await fs.writeFile(file, JSON.stringify({ ...saved, stage: "applying" }));
  const restarted = createOverleaf(options);
  assert.equal((await restarted.status("paper")).transaction.stage, "applied");
  assert.equal(
    await command(
      local,
      "rev-parse",
      `refs/research-overleaf/checkpoints/${review.id}`,
    ),
    review.baseHead,
  );
  assert.equal(await command(local, "rev-parse", "HEAD"), applied.resultHead);
});

test("An external editor racing apply is preserved by Git's final overlap check", async (t) => {
  const { api, options, local, peer } = await fixture(t);
  await commit(peer, "paper.tex", "Remote rewrite\n", "Remote");
  await command(peer, "push");
  const review = await api.plan("paper");
  const runner = createGitRunner();
  const canonical = await fs.realpath(local);
  const raced = createOverleaf({
    ...options,
    git: {
      ...runner,
      run: async (folder, args, ...rest) => {
        if (folder === canonical && args[0] === "reset" && args[1] === "--keep")
          await fs.writeFile(
            path.join(local, "paper.tex"),
            "External typing during apply\n",
          );
        return runner.run(folder, args, ...rest);
      },
    },
  });
  await assert.rejects(
    raced.apply("paper", review.id, {
      expectedHead: review.baseHead,
      expectedRemoteHead: review.remoteHead,
      reviewToken: review.reviewToken,
    }),
  );
  assert.equal(
    await fs.readFile(path.join(local, "paper.tex"), "utf8"),
    "External typing during apply\n",
  );
  assert.equal(await command(local, "rev-parse", "HEAD"), review.baseHead);
});

test("Unsupported symbolic links are rejected before creating a review", async (t) => {
  const { api, local, peer, root } = await fixture(t);
  const outside = path.join(root, "outside.txt");
  await fs.writeFile(outside, "Private outside content\n");
  await fs.symlink(outside, path.join(local, "paper-link"));
  await command(local, "add", "paper-link");
  await command(local, "commit", "-m", "Local link");
  await fs.symlink("paper.tex", path.join(peer, "paper-link"));
  await command(peer, "add", "paper-link");
  await command(peer, "commit", "-m", "Remote link");
  await command(peer, "push");
  await assert.rejects(api.plan("paper"), /does not support symbolic links/);
  assert.equal(await fs.readFile(outside, "utf8"), "Private outside content\n");
  assert.equal((await api.status("paper")).transaction, undefined);
});

test("Unsupported Git LFS pointers and submodules cannot enter the publication review", async (t) => {
  const { api, local } = await fixture(t);
  await commit(
    local,
    "figure.png",
    `version https://git-lfs.github.com/spec/v1\noid sha256:${"a".repeat(64)}\nsize 1000\n`,
    "Add LFS pointer",
  );
  await assert.rejects(api.plan("paper"), /does not support Git LFS pointers/);
  await command(local, "rm", "figure.png");
  const hash = await command(local, "rev-parse", "HEAD");
  await command(local, "clone", local, path.join(local, "vendor"));
  await command(
    local,
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${hash},vendor`,
  );
  await command(local, "commit", "-m", "Add submodule reference");
  await assert.rejects(api.plan("paper"), /does not support submodules/);
});

test("A failed workspace registration keeps the prior connection and preserves cloned sources", async (t) => {
  const { api, root, directory } = await fixture(t);
  const folder = path.join(root, "unregistered-clone");
  const before = await fs.readdir(path.join(directory, "credentials"));
  await assert.rejects(
    api.connect(
      {
        projectId: "new-paper",
        folder,
        url,
        token: "test-secret-token",
        clone: true,
      },
      async () => {
        throw new Error("Workspace disk full");
      },
    ),
    /Workspace disk full/,
  );
  assert.equal((await api.status("new-paper")).connected, false);
  assert.equal((await api.status("paper")).connected, true);
  assert.equal(
    await fs.readFile(path.join(folder, "paper.tex"), "utf8"),
    "Title\n\nOriginal paragraph.\n",
  );
  assert.deepEqual(
    await fs.readdir(path.join(directory, "credentials")),
    before,
  );
});

test("An expired credential can be replaced without abandoning the active review", async (t) => {
  const { api, local, directory } = await fixture(t);
  await commit(local, "paper.tex", "Local source\n", "Local");
  const review = await api.plan("paper");
  const replaced = await api.replaceCredential("paper", "test-secret-token");
  assert.equal(replaced.transaction.id, review.id);
  assert.equal(replaced.transaction.reviewToken, review.reviewToken);
  assert.equal(
    (await fs.readdir(path.join(directory, "credentials"))).length,
    1,
  );
});
