const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  defaultPanelLayout,
  parsePanelLayout,
  fitWorkbench,
  fitBottomPanel,
  fitAgentColumns,
  fitThreeColumns,
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
  for (const workMode of ["agent", "edit", "combined", "columns"]) {
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

test("three columns fit large screens, retain readable widths on small screens and reclaim hidden panels", () => {
  const preferred = parsePanelLayout(
    JSON.stringify({
      workMode: "columns",
      files: 260,
      sourceWidth: 640,
      columnsAgentWidth: 520,
    }),
  );
  assert.equal(preferred.sourceWidth, 640);
  assert.equal(preferred.columnsAgentWidth, 520);
  const large = fitThreeColumns(2200, preferred, true, true);
  assert.equal(large.source, 640);
  assert.equal(large.agent, 520);
  for (const width of [700, 1050, 1250, 1900, 2800]) {
    for (const showPdf of [true, false]) {
      for (const showTools of [true, false]) {
        const panes = fitThreeColumns(width, preferred, showPdf, showTools);
        assert.ok(panes.files >= 140 && panes.files <= 420);
        assert.ok(panes.source >= 240);
        assert.ok(showPdf ? panes.pdf >= 260 : panes.pdf === 0);
        assert.ok(showTools ? panes.agent >= 360 : panes.agent === 0);
        const separators =
          4 + (showPdf || showTools ? 4 : 0) + (showPdf && showTools ? 4 : 0);
        const minimum =
          140 + 240 + (showPdf ? 260 : 0) + (showTools ? 360 : 0) + separators;
        assert.ok(
          Math.abs(
            panes.files +
              panes.source +
              panes.agent +
              panes.pdf +
              separators -
              Math.max(width, minimum),
          ) < 0.01,
        );
      }
    }
  }
  const defaults = fitThreeColumns(2000, defaultPanelLayout, true, true);
  assert.ok(Math.abs(defaults.source - defaults.agent) < 1);
  assert.ok(Math.abs(defaults.source - defaults.pdf) < 1);
  const invalid = parsePanelLayout(
    JSON.stringify({ sourceWidth: -20, columnsAgentWidth: 9999 }),
  );
  assert.equal(invalid.sourceWidth, 240);
  assert.equal(invalid.columnsAgentWidth, 1600);
});
