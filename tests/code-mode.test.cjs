const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createCodexAgent } = require("../electron/codex-agent.cjs");
const { runCodeModeFixture } = require("./code-mode-fixture.cjs");

test(
  "gpt-6-astra Code Mode compiles, repairs two files, and produces a PDF through the bundled local host",
  { timeout: 50000 },
  async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "research-code-mode-"),
    );
    try {
      await runCodeModeFixture({ createCodexAgent, root });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
