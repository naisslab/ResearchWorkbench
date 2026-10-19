const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);

test(
  "native audio levels accept the first frame without clock underflow and throttle subsequent frames",
  {
    skip: process.platform !== "darwin",
    timeout: 30000,
  },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dictation-level-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const main = path.join(root, "main.swift");
    await fs.writeFile(
      main,
      `
var throttle = AudioLevelThrottle()
// A first timestamp of zero is valid; no lazily sampled later clock may be subtracted.
precondition(throttle.shouldEmit(at: 0))
precondition(!throttle.shouldEmit(at: 1))
precondition(!throttle.shouldEmit(at: 49_999_999))
precondition(throttle.shouldEmit(at: 50_000_000))
precondition(throttle.shouldEmit(at: 100_000_000))
// Defensive recovery from a clock reset also avoids unsigned underflow.
precondition(throttle.shouldEmit(at: 5))
precondition(!throttle.shouldEmit(at: 6))
precondition(throttle.shouldEmit(at: UInt64.max))
`,
    );
    const executable = path.join(root, "levels");
    await execFile(
      "/usr/bin/xcrun",
      [
        "swiftc",
        "-O",
        "-module-cache-path",
        path.join(root, "module-cache"),
        path.resolve(__dirname, "../native/AudioLevelThrottle.swift"),
        main,
        "-o",
        executable,
      ],
      { timeout: 25000 },
    );
    await execFile(executable, [], { timeout: 3000 });
  },
);
