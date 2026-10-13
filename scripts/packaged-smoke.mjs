import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const executable =
  process.env.RESEARCH_APP_PATH ||
  path.join(
    root,
    "release",
    process.arch === "arm64" ? "mac-arm64" : "mac",
    "Research Workbench.app/Contents/MacOS/Research Workbench",
  );
if (!existsSync(executable))
  throw new Error(
    "Packaged app missing. Run npm run package first, or set RESEARCH_APP_PATH to its executable.",
  );
const child = spawnSync(
  process.execPath,
  [path.join(root, "scripts/release-smoke.mjs")],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, RESEARCH_APP_PATH: executable },
  },
);
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
