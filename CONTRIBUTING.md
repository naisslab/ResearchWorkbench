# Contributing

Contributors should be able to build and test the app without the maintainer's local research files or accounts.

## Setup

Use Node.js 24 LTS (`.nvmrc`) and npm. Install Xcode 26 or newer and select it with `xcode-select`; its macOS SDK is needed for the native speech helper. A packaged application does not require developer tools.

```sh
npm ci
npm run dev
```

`npm ci` downloads the pinned Electron binary explicitly, then rebuilds `node-pty` for the installed Electron runtime. After changing Electron, run `npm run rebuild:native` before desktop tests. If downloads need a proxy, set the standard `HTTP_PROXY`/`HTTPS_PROXY` variables and `ELECTRON_GET_USE_PROXY=1` for the Electron installer. Keep `package-lock.json` in the same change as dependency edits. Do not commit generated applications, native binaries, credentials, personal research snapshots, or test output.

## Tests

```sh
npm test
npm run build
npm run test:e2e
```

Core tests include real Git and LaTeX operations. GUI suites require an available macOS desktop session. Install a TeX distribution with `latexmk`, pdfLaTeX, XeLaTeX, LuaLaTeX, SyncTeX, and latexdiff to run all manuscript suites. CI installs TeX tools before testing.

Use focused checks for the change: `test:writing-ui`, `test:continuity-ui`, `test:project-continuity-ui`, `test:ai-ui`, `test:review-ui`, `test:native-ui`, and `test:workspace-agent-ui` are available. AI fixtures do not require a real account. `test:dictation-native` uses synthetic recordings; actual microphone permissions and recognition quality need a separate manual check.

The shared smoke harness creates an isolated application-data directory. Historical catalog fixtures are enabled explicitly with `RESEARCH_DEMO_DATA=1`; ordinary startup must never depend on this flag. Never point a test at a real workspace.

## Changes

Keep filesystem and process operations in the Electron main process. Expose specific IPC actions through the preload bridge. Validate imported data and project paths. Preserve recovery copies, conflict detection, cancellation, and credentials isolation when changing a workflow.

Explain the user-visible problem, the resulting behavior, and the relevant checks in your pull request. For migrations, include cases for a clean workspace and an existing workspace. Keep UI wording clear for a researcher who does not use Git or a command line every day.

Use issue reports for reproducible problems and proposals. Include app/OS version, steps, and sanitized diagnostics. See [Security](SECURITY.md) for private vulnerability reporting and [Release](docs/release.md) for packaging.
