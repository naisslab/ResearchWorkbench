const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  defaultPanelLayout,
  parsePanelLayout,
  fitWorkbench,
} = require("../src/panel-layout.ts");
test("panel preferences recover from corrupt storage and reject invalid dimensions", () => {
  assert.deepEqual(parsePanelLayout("broken"), defaultPanelLayout);
  assert.deepEqual(parsePanelLayout(null), defaultPanelLayout);
  assert.deepEqual(
    parsePanelLayout(
      JSON.stringify({
        sidebar: -300,
        files: 9000,
        editorFraction: "wide",
        terminal: -1,
      }),
    ),
    { ...defaultPanelLayout, sidebar: 180, files: 420, terminal: 120 },
  );
  assert.deepEqual(
    parsePanelLayout(
      JSON.stringify({
        ...defaultPanelLayout,
        sidebar: 304,
        files: 260,
        editorFraction: 0.65,
        terminal: 300,
      }),
    ),
    { sidebar: 304, files: 260, editorFraction: 0.65, terminal: 300 },
  );
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
