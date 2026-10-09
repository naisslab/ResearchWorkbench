const fs = require("node:fs/promises");
const path = require("node:path");
const { seedWorkspace } = require("../electron/core.cjs");

async function manuscriptWorkspace(root) {
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, "main.tex"),
    String.raw`\documentclass{article}
\begin{document}
\section{Integration test}
A manuscript used only by automated tests.
\end{document}
`,
  );
  const state = await seedWorkspace();
  state.projects.push({
    id: "test-manuscript",
    name: "Test manuscript",
    areaId: "ml",
    stage: "writing",
    summary: "",
    notes: "",
    venue: "",
    folder: root,
    mainFile: "main.tex",
    sshHost: "",
    tasks: [],
    deadlines: [],
    updatedAt: new Date().toISOString(),
  });
  return state;
}
module.exports = { manuscriptWorkspace };
