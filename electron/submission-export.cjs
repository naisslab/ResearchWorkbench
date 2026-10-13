const fs = require("node:fs/promises");
const { createWriteStream, constants } = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const excludedDirectories = new Set([
  ".git",
  ".research-build",
  ".codex",
  ".agents",
  ".ssh",
  ".aws",
  ".config",
  "node_modules",
  "vendor",
  "build",
  "dist",
  "release",
  "target",
  "__pycache__",
  "venv",
  "env",
  "editor-drafts",
  "pdf-annotations",
  "ai",
]);
const sourceExtensions = new Set([
  ".tex",
  ".ltx",
  ".dtx",
  ".ins",
  ".bib",
  ".bbl",
  ".bst",
  ".cls",
  ".sty",
  ".bbx",
  ".cbx",
  ".def",
  ".cfg",
  ".clo",
  ".fd",
  ".map",
  ".enc",
  ".pfb",
  ".ttf",
  ".otf",
  ".eps",
  ".ps",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".tikz",
  ".pgf",
  ".csv",
  ".tsv",
  ".dat",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".md",
  ".txt",
  ".py",
  ".r",
  ".jl",
  ".m",
  ".sh",
]);
const secretName =
  /(?:^|[-_.])(credentials?|secrets?|tokens?|passwords?|id_rsa|id_ed25519|api[-_]?key)(?:$|[-_.])/i;
const specialNames = new Set([
  "latexmkrc",
  ".latexmkrc",
  "makefile",
  "license",
  "copying",
]);
const within = (root, file) =>
  file === root || file.startsWith(root + path.sep);
const metadata = (value) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, 500)
    : "unknown";

async function exportSubmission(project, destination, options = {}) {
  if (
    !project?.folder ||
    typeof project.mainFile !== "string" ||
    !project.mainFile.endsWith(".tex")
  )
    throw new Error(
      "Choose a manuscript folder and .tex entry file before exporting.",
    );
  const root = await fs.realpath(project.folder);
  const destinationRoot = await fs.realpath(destination);
  if (!(await fs.stat(destinationRoot)).isDirectory())
    throw new Error("Choose a destination folder.");
  if (within(root, destinationRoot))
    throw new Error("Choose an export location outside the manuscript folder.");
  const main = path.resolve(root, project.mainFile);
  if (!within(root, main) || main === root)
    throw new Error("The manuscript entry file must be inside the project.");
  const mainStat = await fs.lstat(main);
  if (
    !mainStat.isFile() ||
    mainStat.isSymbolicLink() ||
    !within(root, await fs.realpath(main))
  )
    throw new Error(
      "The manuscript entry file must be a regular local file inside the project.",
    );
  const mainRelative = path.relative(root, main).split(path.sep).join("/");
  const createdAt = new Date().toISOString();
  const slug =
    String(project.name || "manuscript")
      .normalize("NFKC")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "manuscript";
  const name = `Research-Submission-${slug}-${createdAt.replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  const target = path.join(destinationRoot, name);
  const stage = await fs.mkdtemp(
    path.join(destinationRoot, ".research-export-"),
  );
  await fs.chmod(stage, 0o700);
  const manifest = {
    format: "research-workbench-submission",
    version: 1,
    createdAt,
    mainFile: `source/${mainRelative}`,
    sourceRevision: metadata(options.revision),
    sourceState: "working-copy snapshot; may include uncommitted changes",
    compiler: metadata(options.compiler || project.latexEngine),
    texLive: metadata(options.texLive),
    buildPerformed: false,
    compiledPdf: null,
    pdfMatchesSource:
      "unknown; this export does not compile or certify PDF freshness",
    files: [],
    skipped: [],
  };
  let bytes = 0;
  let entries = 0;
  const skipped = (file, reason) =>
    manifest.skipped.push({ path: file, reason });
  const sourcePdf = path.relative(root, main).replace(/\.tex$/, ".pdf");
  async function copy(source, relative) {
    const real = await fs.realpath(source);
    if (!within(root, real))
      throw new Error(`File moved outside the manuscript folder: ${relative}`);
    const input = await fs.open(
      source,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
    );
    try {
      const before = await input.stat();
      if (!before.isFile())
        throw new Error(`Source is not a regular file: ${relative}`);
      if (bytes + before.size > 1024 * 1024 * 1024)
        throw new Error(
          "Submission export exceeds 1 GB. Move unrelated files out of the manuscript folder.",
        );
      const output = path.join(stage, relative);
      await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
      const digest = crypto.createHash("sha256");
      let copied = 0;
      await pipeline(
        input.createReadStream({ autoClose: false }),
        new Transform({
          transform(chunk, _encoding, done) {
            copied += chunk.length;
            if (bytes + copied > 1024 * 1024 * 1024) {
              done(
                new Error(
                  "Submission export exceeded 1 GB while reading a changing file.",
                ),
              );
              return;
            }
            digest.update(chunk);
            done(null, chunk);
          },
        }),
        createWriteStream(output, { flags: "wx", mode: 0o600 }),
      );
      const after = await input.stat();
      const current = await fs.lstat(source);
      if (
        before.size !== after.size ||
        copied !== before.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        current.ino !== before.ino ||
        current.dev !== before.dev ||
        current.isSymbolicLink() ||
        !within(root, await fs.realpath(source))
      )
        throw new Error(
          `File changed during export: ${relative}. Save your work and try again.`,
        );
      bytes += copied;
      manifest.files.push({
        path: relative.split(path.sep).join("/"),
        bytes: copied,
        sha256: digest.digest("hex"),
      });
    } finally {
      await input.close();
    }
  }
  async function walk(folder, prefix = "") {
    const children = await fs.readdir(folder, { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (++entries > 20000)
        throw new Error(
          "Submission export exceeds 20,000 entries. Choose a smaller manuscript folder.",
        );
      const relative = prefix ? `${prefix}/${child.name}` : child.name;
      const name = child.name.toLowerCase();
      if (child.isSymbolicLink()) {
        skipped(relative, "symbolic link");
        continue;
      }
      if (
        secretName.test(name) ||
        (name.startsWith(".") && name !== ".latexmkrc")
      ) {
        skipped(relative, "private or hidden path");
        continue;
      }
      if (child.isDirectory()) {
        if (excludedDirectories.has(name))
          skipped(relative, "generated, runtime, or private directory");
        else await walk(path.join(folder, child.name), relative);
      } else if (!child.isFile()) skipped(relative, "special file");
      else if (relative === sourcePdf.split(path.sep).join("/"))
        skipped(relative, "compiled manuscript PDF is exported separately");
      else if (
        !specialNames.has(name) &&
        !sourceExtensions.has(path.extname(name))
      )
        skipped(relative, "not a manuscript source or supported asset");
      else await copy(path.join(folder, child.name), `source/${relative}`);
    }
  }
  try {
    await walk(root);
    if (!manifest.files.some((file) => file.path === manifest.mainFile))
      throw new Error(
        "The entry file was excluded. Use a manuscript entry outside hidden or private directories.",
      );
    const pdfName = path.basename(main).replace(/\.tex$/, ".pdf");
    for (const pdf of [
      path.join(path.dirname(main), ".research-build", pdfName),
      path.join(path.dirname(main), pdfName),
    ]) {
      const stat = await fs.lstat(pdf).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (!stat) continue;
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        !within(root, await fs.realpath(pdf))
      ) {
        skipped(path.relative(root, pdf), "PDF is not a regular local file");
        continue;
      }
      await copy(pdf, `output/${pdfName}`);
      manifest.compiledPdf = `output/${pdfName}`;
      break;
    }
    const readme = `# Submission Snapshot\n\nCreated ${createdAt}.\n\nEntry file: ${manifest.mainFile}\nCompiler: ${manifest.compiler}\nTeX Live: ${manifest.texLive}\nSource revision: ${manifest.sourceRevision}\n\nThis is a copy of the current working files, including saved changes that may be uncommitted. No commands were run during export. The existing PDF, when included under output/, may predate the source. Compile the exported sources and check venue and anonymity requirements before submission.\n\nKeep the source/ directory layout intact. Review manifest.json for SHA-256 checksums and skipped paths. Known credential filenames, hidden paths, caches, and symlinks are excluded; inspect the contents before sharing because sensitive text can occur in any source file. The manifest and this README do not include account credentials or project conversation history.\n`;
    await fs.writeFile(path.join(stage, "README.md"), readme, {
      flag: "wx",
      mode: 0o600,
    });
    manifest.files.push({
      path: "README.md",
      bytes: Buffer.byteLength(readme),
      sha256: crypto.createHash("sha256").update(readme).digest("hex"),
    });
    bytes += Buffer.byteLength(readme);
    const manifestText = JSON.stringify(manifest, null, 2) + "\n";
    await fs.writeFile(path.join(stage, "manifest.json"), manifestText, {
      flag: "wx",
      mode: 0o600,
    });
    await fs.rename(stage, target);
    return {
      path: target,
      files: manifest.files.length + 1,
      bytes: bytes + Buffer.byteLength(manifestText),
      skipped: manifest.skipped,
      manifestPath: path.join(target, "manifest.json"),
    };
  } catch (error) {
    await fs.rm(stage, { recursive: true, force: true });
    throw error;
  }
}
module.exports = { exportSubmission };
