# Distribution, Updates, and Reinstallation

This guide separates the publisher's release work from the user's installation steps. Users download a finished application. They do not build the source, obtain signing certificates, or submit anything to Apple.

## Who Signs the App?

The publisher signs each new application build with a Developer ID Application certificate, submits it for notarization, and staples the resulting ticket. Copies of that finished release retain its signature and ticket. Downloading, reinstalling, or updating from a prepared release does not require user-side signing. See [Apple's Developer ID guide](https://developer.apple.com/developer-id/) and [notarization documentation](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

The signing credentials are configured once and maintained as they expire or rotate. The build system uses them for each release. A changed executable needs a newly signed and notarized build; a README-only change does not require repackaging the existing installer.

The current `preview-0.1.0` DMG is unsigned and not notarized. It remains an internal preview, and macOS may block its first launch. The installation script does not disable Gatekeeper, remove quarantine, or ask users to sign the binary themselves.

## Publisher Setup

Before distributing a stable release:

1. Confirm or enroll the publisher in the Apple Developer Program. Create a **Developer ID Application** certificate under the publisher's team.
2. Export that certificate with its private key to a password-protected `.p12`. Store it and the notarization credentials in GitHub Actions secrets, never in this repository or the application.
3. Configure `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` for the `release` environment or repository. The [release guide](release.md#signing-and-notarization) describes the supported configuration.
4. Keep `appId` (`com.research.workbench`), product name (`Research Workbench`), and application support location stable. A repository rename does not require renaming these application identities.
5. Exercise a signed build on a clean Mac before promoting it to a stable release.

At the October 19, 2026 check, this repository had no repository-level secrets, and its `release` environment secrets endpoint was unavailable. No stable release was published. An Apple developer account and certificate have not been confirmed. Organization-level secrets were not inspected. The workflow configuration alone is not evidence that a signed build has run successfully.

## Release a New Version

Use monotonically increasing `MAJOR.MINOR.PATCH` versions. For example, prepare `0.1.1` after the current `0.1.0` preview.

1. Update `package.json` and the lockfile version, record the changes, run the required checks, and push the release commit.
2. Create and push the matching version tag, for example `v0.1.1`.
3. **Prepare Mac Release** builds Apple silicon and Intel DMGs, runs checks, signs and notarizes the apps, tests packaged startup, and creates a draft GitHub release with checksums.
4. Inspect both artifacts and release notes. Test a first installation and an upgrade from the previous version, including workspace and PDF feedback recovery.
5. Publish the draft as a regular release and mark it **Latest**. Keep experimental builds as prereleases. The installer uses GitHub's latest stable release endpoint, which excludes drafts and prereleases.

A source push alone does not create a new distribution. Users need the DMG attached to a published release. Do not replace an existing version's assets with different builds; publish a higher version so installation, checksums, and bug reports identify the same artifact.

Required assets follow the existing naming convention:

| Architecture | Installer | Checksum File |
| --- | --- | --- |
| Apple silicon | `Research-Workbench-<version>-arm64.dmg` | `SHA256SUMS-arm64.txt` |
| Intel | `Research-Workbench-<version>-x64.dmg` | `SHA256SUMS-x64.txt` |

The installer uses the asset SHA-256 digest returned by the authenticated GitHub API. It also verifies the app's bundle identifier, version, Developer ID signature, Gatekeeper assessment, and stapled notarization ticket. A missing artifact or failed verification stops installation. The one known unsigned preview has a pinned checksum and requires `--preview`.

## User Installation and Updates

The [README one-line command](../README.md#one-line-installation) downloads the current installation script through the user's GitHub CLI authentication. Its normal selection is the latest stable release; `--preview` allows the known preview only when no stable release exists. It does not fall back after network or authentication errors.

| User Action | Result |
| --- | --- |
| Run the command with no installed app | Install under `~/Applications`. |
| Rerun after a newer release is published | Update the existing app in place. |
| Rerun when already current | Report the version and leave the app alone. |
| Add `--reinstall` | Replace the app with a newly downloaded, verified copy. |
| Add `--check` | Report the installed and available versions without downloading a DMG. |
| Add `--verify-only` | Download and verify the release without installing it. |

The app must be closed before replacement. The installer does not stop a running app or invoke `sudo`. If both user and system Applications folders contain copies, it asks for an explicit destination through `RESEARCH_WORKBENCH_INSTALL_DIR`. A system installation that the user cannot write should be updated through Finder using the DMG and normal administrator approval.

An installation lock prevents two installer processes from replacing the same destination simultaneously. Replacement stages the new app first and moves the old app into a separate backup directory. If replacement fails, cleanup attempts to restore the old app and reports any backup requiring manual recovery. After a successful launch, users may remove the retained app backup. A forcibly killed installer may leave its lock or backup behind; inspect those paths before retrying.

## Data and Reinstallation

Replacing an application bundle does not reset the workspace. The installer does not remove project folders or the application's support data, including drafts, conversations, PDF feedback, and credentials. Do not instruct users to delete application support data as part of a normal reinstall.

Create a **Complete backup** before an upgrade. Future releases that change data formats should document migration and recovery behavior and test both a fresh installation and an upgrade. Restoring an old application bundle alone may not reverse a data migration. The installer refuses automatic downgrades, including when `--reinstall` is used.

## Private Access and Future Automatic Updates

The current source repository and its release downloads are private. Every user needs repository access and their own GitHub login. Never embed a maintainer token in the app or distribute shared release credentials.

If distribution later needs to reach people without source access, a separate public repository containing only signed release artifacts is one option. That can keep the source private. It would require a deliberate publishing change; the current repository remains private.

A later app-internal updater can offer **Check for Updates**, download in the background, and apply an update after the user quits. That work is not implemented here. It needs signed macOS builds, update metadata and ZIP artifacts, restart behavior, and an authentication design for private downloads. See the installed builder version's [auto-update documentation](https://www.electron.build/v26/docs/features/auto-update/).

For now, the repeatable installer and downloadable DMGs provide installation, updates, and repair without requiring users to build or sign anything.
