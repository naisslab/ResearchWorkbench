# Research Workbench

A local desktop workspace for researchers and principal investigators. Keep projects, manuscripts, references, PDF feedback, deadlines, terminals, and optional AI assistance together while retaining ordinary files on your computer.

**Release status:** development preview for macOS 13 or later. Public binaries require the signing and notarization checks described in [the release guide](docs/release.md). This repository does not yet promise a published, signed installer. Windows and Linux packages are not supported yet.

[中文使用指南](docs/USER_GUIDE.zh-CN.md) · [Contributing](CONTRIBUTING.md) · [Architecture and Roadmap](docs/architecture-and-roadmap.md) · [Security and Privacy](SECURITY.md) · [Changelog](CHANGELOG.md)

## What You Can Do

- Organize research projects, owners, review requests, tasks, milestones, submission stages, and conference deadlines.
- Edit multi-file LaTeX manuscripts, compile locally, and navigate between source and PDF with SyncTeX.
- Find and add references using DOI, arXiv, or title search; inspect citation and submission problems.
- Read and annotate PDFs, preserve feedback across document versions, and export standard PDF annotations.
- Use local and SSH terminals, inspect Git changes, and review manuscript differences.
- Search project files, PDFs, notes, feedback, and saved conversations across the workspace.
- Use optional ChatGPT assistance with reviewable changes, approvals, and local conversation history.
- Recover unsaved drafts, export portable project metadata and submission snapshots, and create complete backups with integrity checks and restore support.

A new installation starts with an empty workspace. Existing workspaces keep their projects and notes. The author's historical research catalog is an explicit development import, described in the release guide.

## Install or Build

Use only a release explicitly identified as signed and notarized on the [GitHub releases page](https://github.com/shinan6/ResearchNativeDesktop/releases). Until one is available, build from source:

```sh
# Node.js 24 LTS; Xcode 26+ selected with xcode-select
npm ci
npm run build
npm run package
```

The local development app appears in `release/mac-arm64/Research Workbench.app` on Apple silicon, or `release/mac/Research Workbench.app` on Intel. `npm run dist` produces a local development DMG. These commands create unsigned artifacts for local testing; they do not publish a release.

You need Xcode 26 or newer to build the native dictation helper. End users of a packaged app do not need Node.js or Xcode. On-device dictation requires macOS 26 or later and a supported speech model; the rest of the app targets macOS 13 or later. Speech models may download on first use.

LaTeX compilation needs an installed TeX distribution containing `latexmk` and your chosen engine. [MacTeX](https://www.tug.org/mactex/) is one option. SyncTeX supports source/PDF navigation; `latexdiff` supports revision comparisons. Project organization and PDF reading work without these tools.

## Open Your First Project

1. On the welcome screen, choose **Open a folder**, **Connect Overleaf**, or **Try an example**. No sign-in is needed for local work.
2. In **Workbench setup**, choose the manuscript entry file and engine.
3. Open the workbench, edit a file, and select **Compile**. Use the build log to resolve missing tools or packages.
4. Add tasks, notes, and submission dates. Create a complete backup before moving to another computer.

AI is optional. **Continue with ChatGPT** connects a supported account through [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source/). Availability and usage depend on the account and service. Files and tool output included in an AI request are sent to OpenAI; see [Security and Privacy](SECURITY.md).

## Collaborate With Overleaf

Keep collaborators working in Overleaf while you use local editing, PDF review, and project management. Overleaf source synchronization uses Git and is distinct from Overleaf's live editor. Use **Connect Overleaf** and follow the [Overleaf collaboration guide](docs/overleaf.md) for token setup, source review, conflict resolution, compilation, and explicit publication.

A downloaded Overleaf source ZIP can also be extracted and opened as a local project. This is an import, not automatic synchronization. Local TeX engines, package versions, fonts, and project build settings may differ from Overleaf. Source files alone do not include Overleaf comment threads or live collaboration state.

## Development and Verification

```sh
npm run dev
npm test
npm run build
npm run test:e2e
```

GUI tests need a macOS desktop session and the indicated LaTeX tools. They use isolated application data. Additional focused suites cover AI, writing, backup, and project continuity; see [Contributing](CONTRIBUTING.md).

## Data and License

The application stores its workspace, drafts, PDF feedback, and conversations under the operating system's application support directory. Settings displays the exact workspace path. Project source files stay in the folders you choose. Removing a project does not remove its files.

Workspace JSON export contains metadata and paths. **Complete backup** can also include linked project folders, PDF snapshots, annotations, and conversation history. Authentication credentials are excluded. Backups contain private research and should be stored accordingly.

Research Workbench is available under the [MIT license](LICENSE). Dependencies and bundled resources retain their own licenses; see [Third-Party Notices](THIRD_PARTY_NOTICES.md).
