// Transcribes synthesized English and Mandarin recordings with the native
// helper and checks that each is recognized in its own language. The first run
// downloads the speech models for the Mac's preferred languages.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

execFileSync(process.execPath, ["scripts/build-dictation.mjs"], {
  stdio: "inherit",
});
const folder = mkdtempSync(path.join(tmpdir(), "dictation-"));
try {
  for (const { voice, text, language, words } of [
    {
      voice: "Eddy (English (US))",
      text: "The results suggest that retrieval improves accuracy on long documents. We will revise the abstract tomorrow.",
      language: /English/,
      words: /tomorrow/i,
    },
    {
      voice: "Eddy (Chinese (China mainland))",
      text: "这个实验说明检索可以提高长文档的准确率。我们明天修改摘要。",
      language: /Chinese/,
      words: /明天/,
    },
  ]) {
    const file = path.join(folder, `${words.source}.aiff`);
    execFileSync("/usr/bin/say", ["-v", voice, text, "-o", file]);
    // The helper treats a closed stdin as cancel, as when the app quits.
    const helper = spawn("build/native/research-dictation", ["--file", file]);
    let output = "";
    helper.stdout.on("data", (bytes) => (output += bytes));
    await new Promise((resolve) => helper.on("close", resolve));
    const events = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const final = events.find((event) => event.type === "final");
    assert.ok(final, JSON.stringify(events.at(-1)));
    assert.match(final.language, language);
    assert.match(final.text, words);
    console.log(`${final.language}: ${final.text}`);
  }
} finally {
  rmSync(folder, { recursive: true, force: true });
}
