import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
export function configurationErrors(env, pkg, config, development = false) {
  const errors = [];
  if (pkg.license !== "MIT")
    errors.push("Set the project license before releasing.");
  if (config.mac?.minimumSystemVersion !== "13.0")
    errors.push("The app must declare its macOS 13.0 deployment floor.");
  if (!config.files?.includes("!electron/research-catalog.json"))
    errors.push("Exclude personal catalog data from release artifacts.");
  if (development) return errors;
  if (
    !config.forceCodeSigning ||
    !config.mac?.hardenedRuntime ||
    !config.mac?.notarize
  )
    errors.push(
      "Public builds must require code signing, hardened runtime, and notarization.",
    );
  if (config.mac?.identity === null || config.mac?.identity === "-")
    errors.push("Public builds cannot use an unsigned or ad-hoc identity.");
  if (!env.CSC_LINK || !env.CSC_KEY_PASSWORD)
    errors.push(
      "Provide CSC_LINK and CSC_KEY_PASSWORD for a Developer ID certificate.",
    );
  const notarization = [
    ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"],
    ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"],
    ["APPLE_KEYCHAIN", "APPLE_KEYCHAIN_PROFILE"],
  ].some((names) => names.every((name) => env[name]));
  if (!notarization)
    errors.push(
      "Provide a complete Apple notarization credential set (see docs/release.md).",
    );
  return errors;
}
function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function verifyApp(app, pkg, development) {
  const plist = path.join(app, "Contents/Info.plist");
  const value = (key) =>
    run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plist]).trim();
  if (value("CFBundleShortVersionString") !== pkg.version)
    throw new Error(`Packaged version does not match package.json: ${app}`);
  if (value("LSMinimumSystemVersion") !== "13.0")
    throw new Error(`Packaged macOS floor is incorrect: ${app}`);
  const resources = path.join(app, "Contents/Resources");
  const helper = path.join(resources, "research-dictation");
  if (!existsSync(helper)) throw new Error(`Missing dictation helper: ${app}`);
  if (!/\bminos 13\.0\b/.test(run("/usr/bin/otool", ["-l", helper])))
    throw new Error(
      "Dictation helper was built for the wrong deployment target.",
    );
  const capability = JSON.parse(run(helper, ["--check"]).trim());
  if (
    capability.type !== "availability" ||
    typeof capability.supportedOS !== "boolean"
  )
    throw new Error("The dictation helper did not report its OS capability.");
  const arch = process.env.RESEARCH_TARGET_ARCH || process.arch;
  run("/usr/bin/lipo", [
    helper,
    "-verify_arch",
    arch === "x64" ? "x86_64" : arch,
  ]);
  for (const file of [
    "Research-Workbench-LICENSE.txt",
    "THIRD_PARTY_NOTICES.md",
    "Inter-LICENSE.txt",
    "JetBrains-Mono-LICENSE.txt",
  ])
    if (!existsSync(path.join(resources, "licenses", file)))
      throw new Error(`Missing packaged notice: ${file}`);
  const { listPackage } = require("@electron/asar");
  if (
    listPackage(path.join(resources, "app.asar")).some((file) =>
      file.endsWith("/electron/research-catalog.json"),
    )
  )
    throw new Error(
      "A public artifact contains the personal research catalog.",
    );
  if (!development) {
    run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
    // codesign reports certificate metadata on stderr.
    const { spawnSync } = require("node:child_process");
    const signature = spawnSync(
      "/usr/bin/codesign",
      ["--display", "--verbose=4", app],
      { encoding: "utf8" },
    );
    if (
      signature.status !== 0 ||
      !signature.stderr.includes("Authority=Developer ID Application:")
    )
      throw new Error(
        "The packaged app lacks a Developer ID Application signature.",
      );
    run("/usr/sbin/spctl", [
      "--assess",
      "--type",
      "execute",
      "--verbose=2",
      app,
    ]);
    run("/usr/bin/xcrun", ["stapler", "validate", app]);
  }
  console.log(
    `${development ? "Development artifact checked (unsigned allowed)" : "Signed and notarized artifact verified"}: ${app}`,
  );
}
function main() {
  const args = process.argv.slice(2);
  const development = args.includes("--development");
  if (
    args.some(
      (arg) =>
        !["--development", "--configuration", "--artifacts"].includes(arg) &&
        !arg.startsWith("--app="),
    )
  )
    throw new Error(
      "Usage: check-release.mjs [--configuration] [--artifacts] [--app=/path/App.app] [--development]",
    );
  if (process.platform !== "darwin")
    throw new Error("Mac release verification must run on macOS.");
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  if (args.includes("--configuration") || !args.includes("--artifacts")) {
    const config = require("../build/electron-builder.release.cjs");
    const errors = configurationErrors(process.env, pkg, config, development);
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      development
        ? "Development configuration checked."
        : "Public release configuration checked.",
    );
  }
  if (args.includes("--artifacts")) {
    const explicit = args.find((arg) => arg.startsWith("--app="))?.slice(6);
    const output = path.join(root, "release");
    const apps = explicit
      ? [path.resolve(explicit)]
      : readdirSync(output, { withFileTypes: true })
          .filter(
            (entry) => entry.isDirectory() && entry.name.startsWith("mac"),
          )
          .flatMap((entry) =>
            readdirSync(path.join(output, entry.name))
              .filter((name) => name.endsWith(".app"))
              .map((name) => path.join(output, entry.name, name)),
          );
    if (!apps.length)
      throw new Error("No packaged app found. Run npm run package first.");
    for (const app of apps) verifyApp(app, pkg, development);
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
