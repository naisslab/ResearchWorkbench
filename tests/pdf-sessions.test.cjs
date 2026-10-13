const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createPdfSessions } = require("../electron/pdf-sessions.cjs");
test("PDF handles survive five projects and byte eviction while preserving the original document version", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "research-pdf-handles-"),
  );
  const sessions = createPdfSessions({ maxBytes: 16, temporaryRoot: root });
  t.after(async () => {
    await sessions.clear();
    await fs.rm(root, { recursive: true, force: true });
  });
  const urls = [];
  for (let i = 0; i < 8; i++) {
    const file = path.join(root, `${i}.pdf`);
    await fs.writeFile(file, `%PDF-${i}-original`);
    urls.push(sessions.open(file, String(i)));
    await sessions.read(String(i), urls[i]);
  }
  assert.ok(sessions.stats().bytes <= 16);
  await fs.writeFile(
    path.join(root, "0.pdf"),
    "%PDF-new-build-with-other-text",
  );
  assert.equal(
    (await sessions.read("0", urls[0])).bytes.toString(),
    "%PDF-0-original",
  );
  await assert.rejects(sessions.read("1", urls[0]), /expired/);
  const newer = sessions.open(path.join(root, "0.pdf"), "0");
  assert.notEqual(newer, urls[0]);
  assert.equal(
    (await sessions.read("0", newer)).bytes.toString(),
    "%PDF-new-build-with-other-text",
  );
  await sessions.clear();
  await assert.rejects(sessions.read("0", urls[0]), /expired/);
});
