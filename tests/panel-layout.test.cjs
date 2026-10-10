const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  defaultPanelLayout,
  parsePanelLayout,
  fitWorkbench,
  fitBottomPanel,
  fitAgentColumns,
} = require("../src/panel-layout.ts");
test("panel preferences recover from corrupt or older storage and reject invalid values", () => {
  assert.deepEqual(parsePanelLayout("broken"), defaultPanelLayout);
  assert.deepEqual(parsePanelLayout(null), defaultPanelLayout);
  assert.deepEqual(
    parsePanelLayout(
      JSON.stringify({
        sidebar: -300,
        files: 9000,
        editorFraction: "wide",
        terminal: -1,
        sidebarCollapsed: "yes",
        bottomOpen: 0,
        bottomTab: null,
      }),
    ),
    { ...defaultPanelLayout, sidebar: 180, files: 420, terminal: 120 },
  );
  const saved = {
    sidebar: 304,
    files: 260,
    editorFraction: 0.65,
    terminal: 300,
  };
  assert.deepEqual(parsePanelLayout(JSON.stringify(saved)), {
    ...defaultPanelLayout,
    ...saved,
  });
  const current = {
    ...defaultPanelLayout,
    ...saved,
    sidebarCollapsed: true,
    bottomOpen: false,
    bottomTab: "build",
  };
  assert.deepEqual(parsePanelLayout(JSON.stringify(current)), current);
});
test("AI gets readable space from legacy layouts and remembers a size independent of Terminal", () => {
  const layout = parsePanelLayout(
    JSON.stringify({ terminal: 120, bottomTab: "ai" }),
  );
  for (const height of [600, 700, 900, 1100]) {
    const panel = fitBottomPanel(height, layout);
    assert.ok(
      panel.height >= 340,
      "The AI transcript needs room above its composer",
    );
    assert.ok(
      panel.height <= height - 260,
      "Keep some manuscript visible in split view",
    );
  }
  assert.ok(
    fitBottomPanel(560, layout).height <= 300,
    "Small windows must fit the composer and manuscript inside the viewport",
  );
  const resized = parsePanelLayout(JSON.stringify({ ...layout, ai: 550 }));
  assert.equal(fitBottomPanel(900, resized).height, 550);
  assert.equal(
    fitBottomPanel(900, { ...resized, bottomTab: "terminal" }).height,
    120,
  );
  assert.equal(
    fitBottomPanel(900, { ...resized, bottomTab: "build" }).height,
    120,
  );
  assert.equal(parsePanelLayout(JSON.stringify({ ai: 80 })).ai, 340);
});
test("pane widths preserve usable editor and PDF widths and fit narrower windows", () => {
  const preferred = { ...defaultPanelLayout, files: 420, editorFraction: 0.9 };
  for (const width of [750, 900, 1250, 1900]) {
    const result = fitWorkbench(width, preferred, true);
    assert.ok(result.files >= 140 && result.files <= 420);
    assert.ok(result.editor >= 240 && result.pdf >= 260);
    assert.equal(result.files + result.editor + result.pdf + 8, width);
  }
  const closedPdf = fitWorkbench(750, preferred, false);
  assert.equal(closedPdf.pdf, 0);
  assert.equal(closedPdf.files + closedPdf.editor + 4, 750);
});

test("work modes migrate to PDF + Agent and column widths fit the workspace", () => {
  const legacy = parsePanelLayout(
    JSON.stringify({ bottomTab: "terminal", bottomOpen: false }),
  );
  assert.equal(legacy.workMode, "agent");
  assert.equal(legacy.bottomTab, "ai");
  assert.equal(legacy.bottomOpen, true);
  assert.equal(
    parsePanelLayout(JSON.stringify({ workMode: "invalid" })).workMode,
    "agent",
  );
  for (const workMode of ["agent", "edit", "combined"]) {
    const saved = parsePanelLayout(
      JSON.stringify({ workMode, agentWidth: 500 }),
    );
    assert.equal(saved.workMode, workMode);
    assert.equal(saved.agentWidth, 500);
  }
  for (const width of [700, 800, 1200, 1800]) {
    for (const preferred of [0, 360, 900]) {
      const result = fitAgentColumns(width, preferred);
      assert.ok(result.width >= 360);
      assert.ok(width - result.width - 4 >= 320);
    }
  }
});
