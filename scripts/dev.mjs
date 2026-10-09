import { spawn } from "node:child_process";
import electron from "electron";
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
  stdio: "inherit",
});
let desktop;
let stopped = false;
function stop() {
  if (stopped) return;
  stopped = true;
  desktop?.kill();
  vite.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (let i = 0; i < 80; i++) {
  try {
    const response = await fetch("http://127.0.0.1:5173");
    if (response.ok) break;
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (i === 79) {
    stop();
    throw new Error("Vite did not start.");
  }
}
desktop = spawn(electron, ["."], {
  stdio: "inherit",
  env: { ...process.env, RESEARCH_DEV_URL: "http://127.0.0.1:5173" },
});
desktop.on("exit", stop);
