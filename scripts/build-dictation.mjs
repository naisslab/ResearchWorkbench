import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The helper must launch on the same OS floor as Electron. Speech APIs are
// availability-guarded inside Swift so older systems receive a useful message.
if (process.platform === "darwin") {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const source = path.join(root, "native/Dictation.swift");
  const throttle = path.join(root, "native/AudioLevelThrottle.swift");
  const plist = path.join(root, "native/Dictation-Info.plist");
  const output = path.join(root, "build/native/research-dictation");
  const stamp = output + ".build.json";
  const arch = process.env.RESEARCH_TARGET_ARCH || process.arch;
  const targetArch = { arm64: "arm64", x64: "x86_64" }[arch];
  if (!targetArch) throw new Error(`Unsupported Mac architecture: ${arch}`);
  const minimum = "13.0";
  const sdk = execFileSync(
    "/usr/bin/xcrun",
    ["--sdk", "macosx", "--show-sdk-path"],
    { encoding: "utf8" },
  ).trim();
  const sdkVersion = execFileSync(
    "/usr/bin/xcrun",
    ["--sdk", "macosx", "--show-sdk-version"],
    { encoding: "utf8" },
  ).trim();
  if (Number(sdkVersion.split(".")[0]) < 26)
    throw new Error(
      "Building dictation requires Xcode 26 or newer (macOS SDK 26+). Install it and select it with xcode-select.",
    );
  const compiler = execFileSync("/usr/bin/xcrun", ["swiftc", "--version"], {
    encoding: "utf8",
  }).trim();
  const fingerprint = createHash("sha256")
    .update(readFileSync(source))
    .update(readFileSync(throttle))
    .update(readFileSync(plist))
    .update(readFileSync(fileURLToPath(import.meta.url)))
    .update(JSON.stringify({ arch, minimum, sdk, sdkVersion, compiler }))
    .digest("hex");
  let previous;
  try {
    previous = JSON.parse(readFileSync(stamp, "utf8"));
  } catch {
    /* First build. */
  }
  if (!existsSync(output) || previous?.fingerprint !== fingerprint) {
    mkdirSync(path.dirname(output), { recursive: true });
    execFileSync(
      "/usr/bin/xcrun",
      [
        "swiftc",
        source,
        throttle,
        "-o",
        output,
        "-O",
        "-sdk",
        sdk,
        "-target",
        `${targetArch}-apple-macosx${minimum}`,
        "-module-cache-path",
        path.join(root, "build/native/module-cache", arch),
        "-Xlinker",
        "-sectcreate",
        "-Xlinker",
        "__TEXT",
        "-Xlinker",
        "__info_plist",
        "-Xlinker",
        plist,
      ],
      { stdio: "inherit" },
    );
    execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", output], {
      stdio: "inherit",
    });
    writeFileSync(
      stamp,
      JSON.stringify(
        { fingerprint, arch, minimum, sdkVersion, compiler },
        null,
        2,
      ) + "\n",
    );
  }
}
