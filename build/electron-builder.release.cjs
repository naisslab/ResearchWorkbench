const { build } = require("../package.json");
const mac = { ...build.mac };
delete mac.identity;
module.exports = {
  ...build,
  forceCodeSigning: true,
  mac: {
    ...mac,
    hardenedRuntime: true,
    notarize: true,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
  },
};
