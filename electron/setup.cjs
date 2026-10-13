const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);
const environment = require("./environment.cjs");

const tools = [
  {
    id: "git",
    name: "Git",
    args: ["--version"],
    purpose: "Source synchronization and revision review",
    url: "https://git-scm.com/downloads/mac",
  },
  {
    id: "latexmk",
    name: "latexmk",
    args: ["-v"],
    purpose: "Build manuscripts",
    url: "https://www.tug.org/mactex/",
  },
  {
    id: "pdflatex",
    name: "pdfLaTeX",
    args: ["--version"],
    purpose: "Default LaTeX engine",
    url: "https://www.tug.org/mactex/",
  },
  {
    id: "xelatex",
    name: "XeLaTeX",
    args: ["--version"],
    purpose: "Optional engine for Unicode and system fonts",
    url: "https://www.tug.org/mactex/",
  },
  {
    id: "lualatex",
    name: "LuaLaTeX",
    args: ["--version"],
    purpose: "Optional Lua-based engine",
    url: "https://www.tug.org/mactex/",
  },
  {
    id: "bibtex",
    name: "BibTeX",
    args: ["--version"],
    purpose: "Build bibliographies",
    url: "https://www.tug.org/mactex/",
  },
  {
    id: "biber",
    name: "Biber",
    args: ["--version"],
    purpose: "Optional biblatex bibliography processor",
    url: "https://www.tug.org/mactex/",
  },
  {
    id: "synctex",
    name: "SyncTeX",
    args: ["--version"],
    purpose: "Navigate between source and PDF",
    url: "https://www.tug.org/mactex/",
  },
  {
    id: "latexdiff",
    name: "latexdiff",
    args: ["--version"],
    purpose: "Optional marked revision PDFs",
    url: "https://www.tug.org/mactex/",
  },
];
async function diagnostics({ env = environment, run = execute } = {}) {
  return Promise.all(
    tools.map(async ({ args, ...tool }) => {
      let executable;
      for (const folder of (env.PATH || "")
        .split(path.delimiter)
        .filter(path.isAbsolute)) {
        const file = path.join(folder, tool.id);
        if (
          await fs.access(file, fs.constants.X_OK).then(
            () => true,
            () => false,
          )
        ) {
          executable = file;
          break;
        }
      }
      if (!executable)
        return {
          ...tool,
          available: false,
          message: "Not installed or not on the application PATH.",
        };
      try {
        const result = await run(executable, args, {
          env,
          timeout: 8000,
          maxBuffer: 64000,
        });
        const version = (result.stdout || result.stderr || "")
          .trim()
          .split("\n")
          .filter(Boolean)
          .slice(0, 2)
          .join(" · ");
        return { ...tool, path: executable, available: true, version };
      } catch {
        return {
          ...tool,
          path: executable,
          available: false,
          message: "The executable could not run. Check its installation.",
        };
      }
    }),
  );
}
function blankProject(areaId, folder, mainFile, name = path.basename(folder)) {
  return {
    id: crypto.randomUUID(),
    areaId,
    name,
    summary: "",
    stage: "writing",
    folder,
    mainFile,
    sshHost: "",
    venue: "",
    notes: "",
    tasks: [],
    deadlines: [],
    updatedAt: new Date().toISOString(),
  };
}
const crypto = require("node:crypto");
async function createExample(parent) {
  const folder = await fs.mkdtemp(path.join(parent, "Research-example-"));
  await fs.writeFile(
    path.join(folder, "main.tex"),
    "\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\title{A Research Workbench Example}\n\\author{Example Researcher}\n\\begin{document}\n\\maketitle\n\\section{Research Question}\nWhat makes a research workflow easy to resume?\n\\section{Next Steps}\nEdit this paragraph, save, and compile. Double-click the PDF to return to its source.\n\\section{References}\nThis synthetic example cites a classic paper~\\cite{shannon1948}.\n\\bibliographystyle{plain}\n\\bibliography{references}\n\\end{document}\n",
    { flag: "wx" },
  );
  await fs.writeFile(
    path.join(folder, "references.bib"),
    "@article{shannon1948,\n  author = {Claude E. Shannon},\n  title = {A Mathematical Theory of Communication},\n  journal = {The Bell System Technical Journal},\n  year = {1948},\n  volume = {27},\n  pages = {379--423}\n}\n",
    { flag: "wx" },
  );
  await fs.writeFile(
    path.join(folder, "README.txt"),
    "This is a synthetic example. Edit main.tex, save, then choose Compile.\nCompilation needs a local TeX installation. Workspace settings can check your setup.\nThe project list, notes, and tasks work without TeX or an AI account.\n",
    { flag: "wx" },
  );
  return folder;
}
module.exports = { diagnostics, blankProject, createExample };
