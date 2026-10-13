# Changelog

## Unreleased

- Add an Overleaf Git connector with encrypted credentials, isolated source review, conflict resolution, recoverable checkpoints, and publication gated by an exact reviewed build.
- Add an empty-workspace welcome flow, a synthetic manuscript example, and local tool diagnostics.
- Add project owners, task assignees and due dates, revision-linked review requests, a PI review inbox, and decision records.
- Add portable project metadata, calendar export, and submission bundles with source checksums and explicit PDF freshness information.
- Preserve the last committed workspace state after failed writes, retain PDF handles across byte-cache eviction, and protect unsaved drafts during repository operations.
- Bound idle workbench retention and start terminals only when requested.
- Start new workspaces without personal projects or submission dates; keep historical imports explicit and preserve existing data.
- Add open-source licensing, contributor guidance, release checks, and Mac CI workflows.
- Define macOS 13 as the application floor and macOS 26 as the on-device dictation requirement.
- Rebuild the dictation helper when its architecture, SDK, compiler, or sources change.
- Update the Electron runtime to a supported release.

## 0.1.0 Development Preview

Local research projects, LaTeX editing and compilation, SyncTeX navigation, PDF feedback, references, deadlines, Git and terminals, optional ChatGPT assistance, cross-project search, draft recovery, and complete backup/restore.
