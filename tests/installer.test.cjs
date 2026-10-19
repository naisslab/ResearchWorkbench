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
[[ "\${MOCK_DOWNLOAD_FAIL:-0}" == 0 ]] || exit 1
printf fixture > "\${@: -1}/Research-Workbench-0.1.0-arm64.dmg"`,
    shasum: 'cat >/dev/null; exit "${MOCK_CHECKSUM_FAIL:-0}"',
    hdiutil: `echo "$1" >> "$MOCK_LOG"
if [[ "$1" == attach ]]; then
  while [[ "$1" != -mountpoint ]]; do shift; done
  mkdir -p "$2/Research Workbench.app/Contents"
  printf fixture > "$2/Research Workbench.app/Contents/Info.plist"
fi`,
    plutil:
      'if [[ "$2" == CFBundleIdentifier ]]; then echo "${MOCK_BUNDLE_ID:-com.research.workbench}"; else echo 0.1.0; fi',
    ditto: 'cp -R "$1" "$2"',
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
            .some((name) => name.startsWith(".research-workbench.")),
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
  assert.match(result.events, /attach\ndetach/);
});

test("verification mode checks the release without installing", (t) => {
  const f = fixture(t),
    result = f.run({}, ["--verify-only"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(f.destination), false);
  assert.match(result.events, /attach\ndetach/);
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
  assert.match(result.events, /attach\ndetach/);
  assert.equal(fs.existsSync(f.destination), false);
});

test("existing installations remain unchanged", (t) => {
  const f = fixture(t),
    app = path.join(f.destination, "Research Workbench.app");
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, "keep"), "original");
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /left unchanged/);
  assert.equal(fs.readFileSync(path.join(app, "keep"), "utf8"), "original");
  assert.doesNotMatch(result.events, /attach/);
});

test("unsupported platforms fail before accessing GitHub", (t) => {
  for (const extra of [{ MOCK_OS: "Linux" }, { MOCK_ARCH: "x86_64" }]) {
    const f = fixture(t),
      result = f.run(extra);
    assert.notEqual(result.status, 0);
    assert.equal(result.events, "");
  }
});
