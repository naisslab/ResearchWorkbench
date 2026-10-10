const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const data = require("./research-catalog.json");
const { DEFAULT_AREAS, stringList } = require("./core.cjs");

async function researchCatalog(
  root = path.join(os.homedir(), "Documents", "GitHub"),
) {
  const candidates = await Promise.all(
    data.entries.map(async (entry) => {
      const folders = [];
      for (const source of entry.folders) {
        const folder = path.join(root, source.path);
        try {
          if (!(await fs.stat(folder)).isDirectory()) continue;
          let mainFile = "";
          if (source.mainFile) {
            try {
              if ((await fs.stat(path.join(folder, source.mainFile))).isFile())
                mainFile = source.mainFile;
            } catch {
              /* A missing manuscript does not prevent metadata import. */
            }
          }
          folders.push({ ...source, folder, mainFile });
        } catch {
          /* Catalogs also work on a Mac without these local repositories. */
        }
      }
      const primary = folders.find((f) => f.mainFile) || folders[0];
      const sourceNote = [
        `Reviewed ${data.checkedAt}. ${entry.statusNote}`,
        ...entry.evidence,
        ...folders.map(
          (f) => `${f.role}: ${f.folder}${f.mainFile ? "/" + f.mainFile : ""}`,
        ),
      ].join("\n");
      return {
        id: entry.id,
        evidence: entry.evidence,
        confidence: entry.confidence,
        collection: entry.collection,
        recommended: entry.recommended,
        statusNote: entry.statusNote,
        project: {
          id: `research-${entry.id}`,
          catalogId: entry.id,
          name: entry.name,
          areaId: entry.areaId,
          topic: entry.topic,
          icon: entry.icon,
          summary: entry.summary,
          stage: entry.stage,
          venue: entry.venue || "",
          folder: primary?.folder || "",
          folderLabel: primary?.role || "Project",
          localFolders: folders
            .filter((f) => f !== primary)
            .map((f, index) => ({
              id: `source-${entry.id}-${index}`,
              label: f.role,
              folder: f.folder,
            })),
          mainFile: primary?.mainFile || "",
          sshHost: "",
          notes: entry.notes || "",
          sourceNote,
          links: entry.links,
          tasks: [],
          deadlines: [],
          updatedAt: new Date().toISOString(),
        },
      };
    }),
  );
  return { checkedAt: data.checkedAt, areas: DEFAULT_AREAS, candidates };
}

function mergeCandidates(state, catalog, ids) {
  const selected = new Set(
    stringList(ids, 500, "Choose projects from the research collection."),
  );
  if ([...selected].some((id) => !catalog.candidates.some((c) => c.id === id)))
    throw new Error("Unknown research project.");
  const additions = catalog.candidates.filter(
    (c) =>
      selected.has(c.id) &&
      !state.projects.some(
        (p) =>
          p.catalogId === c.id ||
          p.id === c.project.id ||
          p.name.trim().toLowerCase() === c.project.name.trim().toLowerCase(),
      ),
  );
  if (!additions.length) return state;
  const areaIds = new Set(additions.map((c) => c.project.areaId));
  return {
    ...state,
    areas: [
      ...state.areas,
      ...catalog.areas.filter(
        (a) => areaIds.has(a.id) && !state.areas.some((old) => old.id === a.id),
      ),
    ],
    projects: [...state.projects, ...additions.map((c) => c.project)],
  };
}
function activateCurrentResearch(state, catalog) {
  if (state.researchSetupVersion === 1) return state;
  const cleaned = {
    ...state,
    projects: state.projects.filter((p) => !p.example),
  };
  const currentIds = catalog.candidates
    .filter((c) => c.collection === "current" && c.confidence !== "review")
    .map((c) => c.id);
  return {
    ...mergeCandidates(cleaned, catalog, currentIds),
    researchSetupVersion: 1,
  };
}

module.exports = { researchCatalog, mergeCandidates, activateCurrentResearch };
