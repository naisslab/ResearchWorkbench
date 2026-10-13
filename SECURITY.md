# Security and Privacy

## Reporting a Vulnerability

Use the repository's [private vulnerability reporting form](https://github.com/shinan6/ResearchNativeDesktop/security/advisories/new) when it is enabled. If that form is unavailable, open an issue asking the maintainer to enable private reporting, without exploit details or sensitive data. Do not post credentials, unpublished manuscripts, private collaborator links, or complete workspace backups in public issues.

Include the affected version, platform, reproduction steps, impact, and a small synthetic example. This project does not yet commit to a response-time SLA. Security fixes target the latest release; check the release notes before reporting.

## Local Data and Network Use

Manuscript files remain in selected local folders. Workspace metadata, recovered drafts, PDF snapshots, annotations, and conversations are stored in the app's user-data directory. Credentials use Electron safeStorage and are excluded from backups. Research content and backups are not encrypted by the app; protect the computer and backup location with appropriate access controls and disk encryption.

AI is optional. Requests to ChatGPT send the selected conversation context, attachments, and tool results to OpenAI. Enabled MCP services may receive data through their tools. DOI/arXiv lookup, conference-feed refresh, Git operations, and account sign-in contact their respective services. Offline project management does not require an AI account.

The renderer has context isolation and sandboxing. Agent permissions and tool approvals constrain agent operations. Local terminal commands execute with the user's permissions. LaTeX project configuration can execute code; the app prompts before trusting changed configuration during manual builds. Review imported projects before trusting their build scripts.

## Release Verification

Public Mac releases must be signed and notarized. `npm run check:release -- --artifacts` verifies packaged app signatures, Gatekeeper assessment, and stapled notarization tickets. Unsigned development artifacts must be labeled as development builds. The release workflow keeps signing credentials out of pull-request jobs.

Review dependencies regularly, keep Electron on a supported release, and preserve bundled license notices. The existence of tests is not a substitute for a release-specific review of changed IPC handlers, permissions, data export, and recovery paths.
