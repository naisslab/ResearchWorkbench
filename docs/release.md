# Mac Release Guide

This guide is for maintainers preparing an installable release. A successful development build does not establish that an app is signed, notarized, or compatible with every supported Mac.

## Supported Targets

The application targets macOS 13 or later on Apple silicon and Intel. On-device dictation requires macOS 26 or later and a supported speech model. The helper launches on the application floor and reports the feature requirement on older systems.

Use Node.js 24 LTS, npm 11+, and Xcode 26+ for development and packaging. The selected SDK must include SpeechAnalyzer. `scripts/build-dictation.mjs` pins the helper deployment target to macOS 13.0 and records a fingerprint of the sources, build script, architecture, SDK, and compiler. `RESEARCH_TARGET_ARCH=arm64` or `x64` selects the helper architecture; use a matching native CI runner for the complete app because Electron and node-pty must match it too.

Electron 44 raises the runtime floor to macOS 13. See the [official Electron 44 release notes](https://www.electronjs.org/blog/electron-44-0). Keep Electron on a supported stable version and rerun native rebuild and desktop checks after changing it.

## Development Builds

```sh
npm ci
npm test
npm run package
npm run check:release -- --artifacts --development
npm run dist
```

`package` creates an app directory. `dist` creates a DMG. Both disable developer signing and notarization and never publish. The explicit `--development` verification checks the app version, OS floor, helper architecture, required notices, and exclusion of the personal catalog. It permits unsigned artifacts and says so in its output.

Use a clean checkout and a clean application-data directory for release candidates. Do not distribute generated test screenshots or workspace data. The smoke harness accepts `RESEARCH_APP_PATH` for testing a packaged executable.

## Signing and Notarization

`npm run dist:release` uses `build/electron-builder.release.cjs`, requires Developer ID signing and notarization, and checks the resulting app. It fails early when signing configuration is incomplete. It never uploads a GitHub release by itself.

Configure the following repository or protected `release` environment secrets for the GitHub workflow:

| Secret | Purpose |
| --- | --- |
| `CSC_LINK` | Base64-encoded exported Developer ID Application certificate, or a supported certificate location |
| `CSC_KEY_PASSWORD` | Password for the exported certificate |
| `APPLE_ID` | Apple account used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific notarization password |
| `APPLE_TEAM_ID` | Developer team identifier |

Local builds can instead use the complete `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` set, or `APPLE_KEYCHAIN` and `APPLE_KEYCHAIN_PROFILE`. Do not put secrets in shell history, repository files, logs, or issue reports. Configure a protected release environment if approval before signing is desired.

The configuration follows [electron-builder v26's Mac signing and notarization options](https://www.electron.build/v26/docs/mac/). The release verifier requires a Developer ID Application signature, successful `codesign --verify`, Gatekeeper assessment, and a valid stapled ticket. It checks the packaged app, including native components, before an artifact is eligible for publication.

## Workflows

**Mac CI** runs tests, renderer/native builds, the main GUI suites, unsigned app packaging, and development package verification on Apple silicon and Intel. It needs no signing credentials. GitHub Actions results must be reviewed after the workflows actually run; adding the files is not evidence that hosted CI passed.

**Prepare Mac Release** supports manual runs and version tags. A manual run with `publish` disabled creates development artifacts without signing secrets. A `v<package version>` tag, or a manual run on that tag with `publish` enabled, requires signing secrets and creates a **draft** GitHub release after both architectures pass. The workflow records SHA-256 checksums. Review the draft and installation checks before making it public.

Before publishing, verify installation on another Mac or clean account, test the oldest supported OS, confirm operation without MacTeX or an AI login, check recovery and backup/restore, and exercise one representative Overleaf project. Confirm that the release contains the required third-party notices. Automated tests do not validate real account access or microphone permission behavior.

App-internal background updates are not implemented. The installer discovers the latest stable GitHub release and supports in-place upgrades, explicit reinstalls, and version checks. Stable installs require checksum, Developer ID signature, Gatekeeper, and stapled-ticket verification. The unsigned preview requires explicit opt-in. See [Distribution and Updates](distribution.md) for release promotion, client behavior, backups, and the remaining signing setup.

## Historical Personal Data

Ordinary startup never seeds personal research projects or dates. Existing records survive upgrades. The author's historical catalog is excluded from packaged applications.

For a source-tree development session only, `RESEARCH_DEMO_DATA=1 npm run dev` enables the historical importer. This loads real historical catalog metadata, not synthetic example data; keep it out of screenshots and public sample workspaces unless the owner approves those records. Prefer a disposable test data directory. Clearing the flag does not delete imported records. Import a workspace export or complete backup to migrate existing personal data between installed apps.
