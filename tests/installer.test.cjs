const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Exercise installation and failure cleanup without network access or mounting disks.
function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "workbench-installer-test-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  const tmp = path.join(root, "tmp");
  const destination = path.join(root, "Applications");
  fs.mkdirSync(bin);
  fs.mkdirSync(tmp);
  const commands = {
    uname:
      'if [[ "$1" == -s ]]; then echo "${MOCK_OS:-Darwin}"; else echo "${MOCK_ARCH:-arm64}"; fi',
    sysctl: "echo 0",
    sw_vers: "echo 15.0",
    gh: `echo gh >> "$MOCK_LOG"
if [[ "$1" == auth ]]; then exit 0; fi
if [[ "$1" == api ]]; then
  case "$2" in
    */releases/latest)
      if [[ "\${MOCK_NO_STABLE:-0}" == 1 ]]; then echo 'gh: Not Found (HTTP 404)' >&2; exit 1; fi
      if [[ "\${MOCK_NETWORK_FAIL:-0}" == 1 ]]; then echo 'connection failed' >&2; exit 1; fi
      echo v0.2.0 ;;
    */releases/tags/*) printf 'sha256:%064d\n' 0 ;;
  esac
  exit 0
fi
[[ "\${MOCK_DOWNLOAD_FAIL:-0}" == 0 ]] || exit 1
while [[ "$1" != --pattern ]]; do shift; done
asset="$2"
printf fixture > "\${@: -1}/$asset"`,
    shasum: 'cat >/dev/null; exit "${MOCK_CHECKSUM_FAIL:-0}"',
    hdiutil: `echo "$1" >> "$MOCK_LOG"
if [[ "$1" == attach ]]; then
  while [[ "$1" != -mountpoint ]]; do shift; done
  mkdir -p "$2/Research Workbench.app/Contents"
  echo "\${MOCK_PACKAGE_VERSION:-0.2.0}" > "$2/Research Workbench.app/Contents/Info.plist"
fi`,
    plutil: `file="\${@: -1}"
if [[ "$2" == CFBundleIdentifier ]]; then
  echo "\${MOCK_BUNDLE_ID:-com.research.workbench}"
else cat "$file"; fi`,
    pgrep: '[[ "${MOCK_RUNNING:-0}" == 1 ]]',
    codesign: `echo codesign >> "$MOCK_LOG"
[[ "\${MOCK_SIGNATURE_FAIL:-0}" == 0 ]] || exit 1
if [[ "$1" == --display ]]; then echo 'Authority=Developer ID Application: Fixture'; fi`,
    spctl: 'echo spctl >> "$MOCK_LOG"; exit "${MOCK_GATEKEEPER_FAIL:-0}"',
    xcrun: 'echo stapler >> "$MOCK_LOG"; exit "${MOCK_STAPLE_FAIL:-0}"',
    ditto: 'cp -R "$1" "$2"',
    mv: `if [[ "\${MOCK_REPLACE_FAIL:-0}" == 1 && "$1" == -n ]]; then exit 1; fi
/bin/mv "$@"`,
  };
  for (const [name, body] of Object.entries(commands)) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/bash\nset -e\n${body}\n`, {
      mode: 0o755,
    });
  }
  return {
    destination,
    run(extra = {}, args = []) {
      const result = spawnSync(
        "/bin/bash",
        [path.resolve(__dirname, "../scripts/install-macos.sh"), ...args],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}:/usr/bin:/bin`,
            TMPDIR: tmp,
            RESEARCH_WORKBENCH_INSTALL_DIR: destination,
            MOCK_LOG: path.join(root, "events"),
            ...extra,
          },
        },
      );
      assert.deepEqual(
        fs.readdirSync(tmp),
        [],
        "download and mount directories must be cleaned up",
      );
      if (fs.existsSync(destination))
        assert.ok(
          !fs
            .readdirSync(destination)
            .some(
              (name) =>
                name.startsWith(".research-workbench.") ||
                name === ".research-workbench-install-lock",
            ),
        );
      return {
        ...result,
        events: fs.existsSync(path.join(root, "events"))
          ? fs.readFileSync(path.join(root, "events"), "utf8")
          : "",
      };
    },
  };
}

test("installer copies the verified app and detaches the disk", (t) => {
  const f = fixture(t),
    result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    fs.existsSync(
      path.join(f.destination, "Research Workbench.app/Contents/Info.plist"),
    ),
  );
  assert.match(result.events, /attach/);
  assert.match(result.events, /detach/);
});

test("verification mode checks the release without installing", (t) => {
  const f = fixture(t),
    result = f.run({}, ["--verify-only"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(f.destination), false);
  assert.match(result.events, /attach/);
  assert.match(result.events, /detach/);
});

test("checksum failure stops before mounting or copying", (t) => {
  const f = fixture(t),
    result = f.run({ MOCK_CHECKSUM_FAIL: "1" });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.events, /attach/);
  assert.equal(fs.existsSync(f.destination), false);
});

test("download failure cleans temporary files", (t) => {
  const f = fixture(t),
    result = f.run({ MOCK_DOWNLOAD_FAIL: "1" });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.events, /attach/);
});

test("unexpected app identity stops installation and detaches", (t) => {
  const f = fixture(t),
    result = f.run({ MOCK_BUNDLE_ID: "example.wrong-app" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /identity or version/);
  assert.match(result.events, /attach/);
  assert.match(result.events, /detach/);
  assert.equal(fs.existsSync(f.destination), false);
});

function installed(f, version) {
  const app = path.join(f.destination, "Research Workbench.app");
  fs.mkdirSync(path.join(app, "Contents"), { recursive: true });
  fs.writeFileSync(path.join(app, "Contents/Info.plist"), version);
  fs.writeFileSync(path.join(app, "keep"), "original");
  return app;
}

test("an older installed version is upgraded and retained as a backup", (t) => {
  const f = fixture(t),
    app = installed(f, "0.1.0"),
    result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    fs.readFileSync(path.join(app, "Contents/Info.plist"), "utf8").trim(),
    "0.2.0",
  );
  const backup = fs
    .readdirSync(f.destination)
    .find((n) => n.startsWith(".research-workbench-backup."));
  assert.equal(
    fs.readFileSync(
      path.join(f.destination, backup, "Research Workbench.app/keep"),
      "utf8",
    ),
    "original",
  );
});

test("same-version installation is a no-op unless reinstall is requested", (t) => {
  const f = fixture(t),
    app = installed(f, "0.2.0");
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Already current/);
  assert.doesNotMatch(result.events, /attach/);
  assert.equal(fs.readFileSync(path.join(app, "keep"), "utf8"), "original");
  const reinstalled = f.run({}, ["--reinstall"]);
  assert.equal(reinstalled.status, 0, reinstalled.stderr);
  assert.equal(fs.existsSync(path.join(app, "keep")), false);
});

test("failed replacement restores the original application", (t) => {
  const f = fixture(t),
    app = installed(f, "0.1.0"),
    result = f.run({ MOCK_REPLACE_FAIL: "1" });
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(path.join(app, "keep"), "utf8"), "original");
});

test("a newer installed version is never downgraded", (t) => {
  const f = fixture(t),
    app = installed(f, "0.10.0"),
    result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to downgrade/);
  assert.equal(fs.readFileSync(path.join(app, "keep"), "utf8"), "original");
});

test("check mode reports versions without downloads or installation", (t) => {
  const f = fixture(t),
    result = f.run({}, ["--check"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /available: 0.2.0/);
  assert.doesNotMatch(result.events, /attach/);
  assert.equal(fs.existsSync(f.destination), false);
});

test("unsigned preview needs explicit opt-in and is never used on network failures", (t) => {
  const f = fixture(t);
  const refused = f.run({ MOCK_NO_STABLE: "1" });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /Use --preview/);
  const preview = f.run(
    { MOCK_NO_STABLE: "1", MOCK_PACKAGE_VERSION: "0.1.0" },
    ["--preview", "--verify-only"],
  );
  assert.equal(preview.status, 0, preview.stderr);
  assert.doesNotMatch(preview.events, /codesign/);
  const network = f.run({ MOCK_NETWORK_FAIL: "1" }, ["--preview"]);
  assert.notEqual(network.status, 0);
  assert.match(network.stderr, /connection failed/);
});

test("signed releases fail closed on signature, Gatekeeper, or ticket errors", (t) => {
  for (const key of [
    "MOCK_SIGNATURE_FAIL",
    "MOCK_GATEKEEPER_FAIL",
    "MOCK_STAPLE_FAIL",
  ]) {
    const f = fixture(t),
      result = f.run({ [key]: "1" });
    assert.notEqual(result.status, 0);
    assert.match(result.events, /detach/);
    assert.equal(fs.existsSync(f.destination), false);
  }
});

test("running applications are left open and unchanged", (t) => {
  const f = fixture(t),
    app = installed(f, "0.1.0"),
    result = f.run({ MOCK_RUNNING: "1" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Quit Research Workbench/);
  assert.equal(fs.readFileSync(path.join(app, "keep"), "utf8"), "original");
});

test("Intel downloads use the x64 stable asset", (t) => {
  const f = fixture(t),
    result = f.run({ MOCK_ARCH: "x86_64" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /x64/);
});

test("unsupported platforms fail before accessing GitHub", (t) => {
  for (const extra of [{ MOCK_OS: "Linux" }, { MOCK_ARCH: "riscv64" }]) {
    const f = fixture(t),
      result = f.run(extra);
    assert.notEqual(result.status, 0);
    assert.equal(result.events, "");
  }
});
