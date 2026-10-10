const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The renderer, preload and main process meet only through channel names, so
// a typo or a forgotten handler surfaces here instead of at runtime.
const read = (file) =>
  fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const preload = read("electron/preload.cjs");
const main = read("electron/main.cjs");
const types = read("src/types.ts");

const exposed = [
  ...preload.matchAll(/(\w+):\s*(invoke|listen)\(\s*"([^"]+)"/g),
].map(([, name, kind, channel]) => ({ name, kind, channel }));
// Handlers are registered directly, from a channel map, or in small loops.
const handled = new Set([
  ...[...main.matchAll(/handle\(\s*"([^"]+)"/g)].map((m) => m[1]),
  ...[...main.matchAll(/^\s*"(ai:[\w-]+)":/gm)].map((m) => m[1]),
  ...[...main.matchAll(/^\s*\["([\w-]+:[\w-]+)",/gm)].map((m) => m[1]),
  ...[
    ...main.matchAll(
      /for \(const \w+ of (\[[^\]]*\])\) \{?\s*handle\(`(\w+):\$\{/g,
    ),
  ].flatMap(([, list, prefix]) =>
    JSON.parse(list).map((name) => `${prefix}:${name}`),
  ),
]);
const api = types.slice(
  types.indexOf("export interface ResearchAPI {"),
  types.indexOf("\n}\n", types.indexOf("export interface ResearchAPI {")),
);
const members = new Set([...api.matchAll(/^  (\w+)\??\(/gm)].map((m) => m[1]));

test("every preload call has a main-process handler", () => {
  const missing = exposed
    .filter((e) => e.kind === "invoke" && !handled.has(e.channel))
    .map((e) => `${e.name} → ${e.channel}`);
  assert.deepEqual(missing, []);
  assert.ok(exposed.length > 60, "the preload parser found the API");
});

test("the preload API and ResearchAPI declare the same members", () => {
  const names = new Set(exposed.map((e) => e.name));
  assert.deepEqual(
    [...names].filter((name) => !members.has(name)),
    [],
    "exposed but not typed",
  );
  assert.deepEqual(
    [...members].filter((name) => !names.has(name)),
    [],
    "typed but not exposed",
  );
});

test("every event the renderer listens for is sent by the main process", () => {
  const sent = new Set([
    ...[...main.matchAll(/send\(\s*"([^"]+)"/g)].map((m) => m[1]),
    ...[...read("electron/ai.cjs").matchAll(/emit\(\s*"([\w-]+)"/g)].map(
      (m) => `ai:${m[1]}`,
    ),
  ]);
  const silent = exposed
    .filter((e) => e.kind === "listen" && !sent.has(e.channel))
    .map((e) => `${e.name} ← ${e.channel}`);
  assert.deepEqual(silent, []);
});

test("every application menu command is registered by the app or the workbench", () => {
  const menuIds = [
    ...read("electron/menu.cjs").matchAll(/command\(\s*"[^"]+",\s*"([^"]+)"/g),
  ].map((m) => m[1]);
  const sources = read("src/App.tsx") + read("src/Workbench.tsx");
  // Literal ids, and ids built as `prefix-${name}` from a list of names.
  const literal = new Set(
    [...sources.matchAll(/id: "([\w-]+)"/g)].map((m) => m[1]),
  );
  const prefixes = [...sources.matchAll(/id: `([\w-]+)-\$\{/g)].map(
    (m) => m[1],
  );
  const handledInApp = ["search", "commands"].filter((id) =>
    read("src/App.tsx").includes(`"${id}"`),
  );
  const missing = menuIds.filter(
    (id) =>
      !literal.has(id) &&
      !handledInApp.includes(id) &&
      !prefixes.some(
        (prefix) =>
          id.startsWith(prefix + "-") &&
          sources.includes(`["${id.slice(prefix.length + 1)}",`),
      ),
  );
  assert.ok(menuIds.length > 15, "the menu parser found the commands");
  assert.deepEqual(missing, []);
});
