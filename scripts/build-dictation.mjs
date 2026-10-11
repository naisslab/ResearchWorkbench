import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

if (process.platform === "darwin") {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const source = path.join(root, "native/Dictation.swift");
  const plist = path.join(root, "native/Dictation-Info.plist");
  const output = path.join(root, "build/native/research-dictation");
  const newer = (file) => {
    try {
      return statSync(file).mtimeMs;
    } catch {
      return 0;
    }
  };
  if (newer(output) < Math.max(newer(source), newer(plist))) {
    mkdirSync(path.dirname(output), { recursive: true });
    execFileSync(
      "/usr/bin/swiftc",
      [
        source,
        "-o",
        output,
        "-O",
        "-module-cache-path",
        path.join(root, "build/native/module-cache"),
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
  }
}
