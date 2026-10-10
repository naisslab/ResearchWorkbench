const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  researchCatalog,
  mergeCandidates,
  activateCurrentResearch,
} = require("../electron/catalog.cjs");
const { validateState } = require("../electron/core.cjs");

test("current research replaces placeholders and preserves existing project edits", async () => {
  const catalog = await researchCatalog(
    "/tmp/nonexistent-research-catalog-root",
  );
  const existing = mergeCandidates(
    { version: 1, areas: catalog.areas, projects: [] },
    catalog,
    ["flowwise"],
  );
  existing.projects[0].notes = "My notes and tasks stay intact";
  existing.projects[0].stage = "published";
  existing.projects.push({
    ...existing.projects[0],
    id: "example-1",
    name: "Adaptive Inference",
    catalogId: undefined,
    example: true,
  });
  const userProject = {
    ...existing.projects[0],
    id: "user-project",
    name: "My own research",
    catalogId: undefined,
  };
  existing.projects.push(userProject);
  const next = activateCurrentResearch(existing, catalog);
  validateState(next);
  assert.equal(next.projects.length, 23);
  assert.equal(
    next.projects.some((p) => p.example),
    false,
  );
  assert.equal(next.projects[0], existing.projects[0]);
  assert.equal(
    next.projects.find((p) => p.id === "user-project"),
    userProject,
  );
  assert.equal(next.projects[0].stage, "published");
  assert.equal(next.projects[0].notes, "My notes and tasks stay intact");
  for (const candidate of catalog.candidates.filter(
    (c) => c.collection === "current" && c.confidence !== "review",
  ))
    assert.ok(next.projects.some((p) => p.catalogId === candidate.id));
  assert.equal(next.projects.filter((p) => p.areaId === "ml").length, 13);
  assert.equal(next.projects.filter((p) => p.areaId === "security").length, 7);
  assert.equal(next.projects.filter((p) => p.areaId === "cps").length, 3);
  next.projects = next.projects.filter((p) => p.catalogId !== "pacc");
  assert.equal(activateCurrentResearch(next, catalog), next);
  assert.equal(
    next.projects.some((p) => p.catalogId === "pacc"),
    false,
  );
});

test("catalog retains evidence without inventing deadlines or unavailable local attachments", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "research-catalog-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "pacc-paper"));
  await fs.writeFile(
    path.join(root, "pacc-paper/paper.tex"),
    "\\begin{document}",
  );
  const catalog = await researchCatalog(root);
  const pacc = catalog.candidates.find((c) => c.id === "pacc");
  assert.equal(pacc.project.mainFile, "paper.tex");
  assert.equal(pacc.project.folder, path.join(root, "pacc-paper"));
  assert.equal(
    catalog.candidates.find((c) => c.id === "flowwise").project.folder,
    "",
  );
  for (const id of ["ghostaccess", "flowwise"])
    assert.equal(
      catalog.candidates.find((c) => c.id === id).project.stage,
      "accepted",
    );
  assert.ok(
    catalog.candidates.every(
      (c) =>
        c.evidence.length &&
        c.project.sourceNote &&
        !c.project.deadlines.length,
    ),
  );
  assert.ok(
    catalog.candidates
      .filter((c) => c.confidence === "review")
      .every((c) => !c.recommended),
  );
  validateState(
    mergeCandidates(
      { version: 1, areas: [], projects: [] },
      catalog,
      catalog.candidates.map((c) => c.id),
    ),
  );
});

test("catalog additions preserve edited projects and areas and skip duplicates", async () => {
  const catalog = await researchCatalog(
    "/tmp/nonexistent-research-catalog-root",
  );
  const initial = {
    version: 1,
    areas: [{ ...catalog.areas[0], name: "My custom area", color: "#123456" }],
    projects: [],
  };
  const first = mergeCandidates(initial, catalog, ["flowwise", "pacc"]);
  first.projects[0].notes = "My actual camera-ready notes";
  first.projects[0].name = "FlowWise renamed";
  const again = mergeCandidates(first, catalog, [
    "flowwise",
    "pacc",
    "ghostaccess",
  ]);
  assert.equal(again.projects.length, 3);
  assert.equal(again.projects[0].notes, "My actual camera-ready notes");
  assert.equal(again.areas[0].name, "My custom area");
  assert.equal(again.areas[0].color, "#123456");
  assert.ok(again.areas.some((a) => a.id === "security"));
  assert.throws(
    () => mergeCandidates(initial, catalog, ["arbitrary-folder"]),
    /Unknown/,
  );
  const existing = {
    ...initial,
    projects: [
      {
        ...catalog.candidates[0].project,
        id: "user-created",
        catalogId: undefined,
      },
    ],
  };
  assert.equal(
    mergeCandidates(existing, catalog, [catalog.candidates[0].id]).projects
      .length,
    1,
  );
});

test("workspace validation checks external project links before persistence", async () => {
  const catalog = await researchCatalog(
    "/tmp/nonexistent-research-catalog-root",
  );
  const state = mergeCandidates(
    { version: 1, areas: [], projects: [] },
    catalog,
    ["flowwise"],
  );
  state.projects[0].links = [{ label: "Bad link", url: "javascript:alert(1)" }];
  assert.throws(() => validateState(state), /HTTP or HTTPS/);
});
