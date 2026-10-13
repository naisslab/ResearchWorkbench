const test = require("node:test");
const assert = require("node:assert/strict");
const pkg = require("../package.json");
const config = require("../build/electron-builder.release.cjs");
test("public releases refuse missing credentials while explicit development checks work", async () => {
  const { configurationErrors } = await import("../scripts/check-release.mjs");
  assert.equal(configurationErrors({}, pkg, config).length, 2);
  assert.deepEqual(configurationErrors({}, pkg, config, true), []);
  const env = {
    CSC_LINK: "certificate",
    CSC_KEY_PASSWORD: "password",
    APPLE_ID: "account",
    APPLE_APP_SPECIFIC_PASSWORD: "secret",
    APPLE_TEAM_ID: "team",
  };
  assert.deepEqual(configurationErrors(env, pkg, config), []);
  const errors = configurationErrors(env, pkg, {
    ...config,
    mac: { ...config.mac, identity: null },
  });
  assert.match(errors.join(" "), /unsigned/);
});
test("release configuration excludes personal data and preserves the deployment floor", async () => {
  const { configurationErrors } = await import("../scripts/check-release.mjs");
  const errors = configurationErrors(
    {},
    pkg,
    {
      ...config,
      files: [],
      mac: { ...config.mac, minimumSystemVersion: undefined },
    },
    true,
  );
  assert.equal(errors.length, 2);
});
test("catalog is empty without an explicit historical-data opt-in", async () => {
  const { researchCatalog } = require("../electron/catalog.cjs");
  const result = await researchCatalog(undefined, {
    includePersonalData: false,
  });
  assert.deepEqual(result.candidates, []);
});
