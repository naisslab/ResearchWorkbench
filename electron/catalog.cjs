const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const data = require("./research-catalog.json");

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
  return { checkedAt: data.checkedAt, areas: data.areas, candidates };
}

function mergeCandidates(state, catalog, ids) {
  if (
    !Array.isArray(ids) ||
    ids.length > 500 ||
    ids.some((id) => typeof id !== "string")
  )
    throw new Error("Choose projects from the research collection.");
  const selected = new Set(ids);
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

function correctFlowWiseStatus(state) {
  if (state.flowWiseStatusVersion === 1) return state;
  return {
    ...state,
    flowWiseStatusVersion: 1,
    projects: state.projects.map((p) =>
      (p.catalogId === "flowwise" ||
        p.name.trim().toLowerCase() === "flowwise") &&
      !["accepted", "published"].includes(p.stage)
        ? { ...p, stage: "accepted", updatedAt: new Date().toISOString() }
        : p,
    ),
  };
}

function organizeLocalFolders(state, catalog) {
  if (state.localFilesVersion === 1) return state;
  return {
    ...state,
    localFilesVersion: 1,
    projects: state.projects.map((project) => {
      const source = catalog.candidates.find(
        (c) => c.id === project.catalogId,
      )?.project;
      // A custom folder attachment takes precedence over the catalog.
      if (
        !source ||
        source.folder !== project.folder ||
        project.localFolders !== undefined
      )
        return project;
      return {
        ...project,
        folderLabel: source.folderLabel,
        localFolders: source.localFolders,
      };
    }),
  };
}

function attachImportedManuscripts(state, catalog) {
  const imported = { ...state.manuscriptImports };
  let changed = false;
  const projects = state.projects.map((project) => {
    const id = project.catalogId;
    if (
      !["web-rag", "hillinfer", "synthetic-data-sok"].includes(id) ||
      imported[id]
    )
      return project;
    const source = catalog.candidates.find(
      (candidate) => candidate.id === id,
    )?.project;
    if (!source?.folder || !source.mainFile) return project;
    imported[id] = true;
    changed = true;
    // Preserve custom attachments and every user-edited project field.
    if (project.folder) return project;
    return {
      ...project,
      folder: source.folder,
      folderLabel: source.folderLabel,
      mainFile: source.mainFile,
      links: [
        ...(project.links || []),
        ...(source.links || []).filter(
          (link) => !(project.links || []).some((existing) => existing.url === link.url),
        ),
      ],
      localFolders: source.localFolders,
      updatedAt: new Date().toISOString(),
    };
  });
  return changed ? { ...state, projects, manuscriptImports: imported } : state;
}

module.exports = {
  researchCatalog,
  mergeCandidates,
  activateCurrentResearch,
  correctFlowWiseStatus,
  organizeLocalFolders,
  attachImportedManuscripts,
};
