# Research Workbench: Architecture and Product Roadmap

This assessment is for maintainers deciding what to ship to researchers and principal investigators. It examines the implementation, including the release work following checkpoint `a727add`. Source links below identify implemented behavior; recommendations are marked as proposed.

The strongest product direction is a local research workbench that connects manuscripts, review, project context and existing collaboration tools. A researcher should be able to resume a paper, understand outstanding feedback, make a revision and return it to collaborators. A PI should be able to see which project needs attention and record a review against an identifiable source revision.

The repository already contained substantial research workflows before this release work. Its larger gaps were dependable first use, distribution, data portability and collaboration boundaries. New work addresses those gaps while preserving the existing editor and PDF workflow. Installation on another person's computer and use with real collaborators remain essential validation steps.

## What Was Already Substantial

| Existing Capability                                                                      | Evidence                                                                                                                             | Value to a Researcher                                                 |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Research areas, project stages, tasks, blockers, milestones and tracked conference dates | [Project model](../src/types.ts), [overview](../src/views/OverviewView.tsx), [deadline handling](../electron/deadlines.cjs)          | Keeps the paper and its next actions in one place                     |
| Multi-file LaTeX editing, outline, labels and citation completion                        | [Manuscript traversal](../src/latex-project.ts), [live manuscript state](../src/useManuscript.ts), [workbench](../src/Workbench.tsx) | Supports an existing paper split across files                         |
| Local builds, multiple TeX engines, SyncTeX and marked revision PDFs                     | [Build and file services](../electron/core.cjs), [Git panel](../src/GitPanel.tsx)                                                    | Connects the source, rendered result and revision history             |
| DOI/arXiv/title lookup and BibTeX insertion                                              | [Reference interface](../src/AddReference.tsx), [reference service](../electron/references.cjs)                                      | Adds citations with a chance to inspect and correct their metadata    |
| Highlights, notes, drawings, PDF version storage and export                              | [PDF reader](../src/PdfReader.tsx), [annotation store](../electron/pdf-annotations.cjs)                                              | Preserves review feedback against the PDF that was actually annotated |
| Recovery drafts, disk-change checks, backups and restore                                 | [Draft lifecycle](../src/useEditorDraft.ts), [backup service](../electron/backup.cjs)                                                | Protects interrupted work and supports moving to another computer     |
| Search across projects, files, PDFs, annotations and conversations                       | [Search service](../electron/search.cjs), [worker](../electron/search-worker.cjs)                                                    | Helps resume work across a portfolio                                  |
| Project agents, change review and workspace actions                                      | [AI service](../electron/ai.cjs), [change store](../electron/ai-changes.cjs), [workspace tools](../electron/workspace-tools.cjs)     | Provides optional assistance within the same project context          |

These are working code paths, with tests for several failure cases. For example, [core tests](../tests/core.test.cjs) exercise failed atomic replacement, path containment, multi-file SyncTeX and revision compilation. [Annotation tests](../tests/pdf-annotations.test.cjs) cover version isolation, export and saved feedback. The presence of tests is distinct from a successful run on a particular release artifact.

## Changes in This Release Work

### Neutral First Use and Installation

Ordinary startup now begins with a generic Research area and no personal projects. Personal imports require an explicit development flag. The [migration service](../electron/migrations.cjs) preserves existing records without automatically adding the author's portfolio. The historical catalog is excluded from packaged applications.

The [welcome view](../src/Welcome.tsx) offers an existing folder, Overleaf connection, synthetic example and project-metadata import. [Setup diagnostics](../electron/setup.cjs) check the tools needed for compilation and source synchronization. Local project management and PDF work do not require an AI account.

The repository now includes licensing and contribution guidance, release verification, packaging configuration and CI workflows. The [release guide](release.md) distinguishes development artifacts from signed and notarized releases. Its installation checks must be performed on actual target computers; local compilation cannot establish them.

### Persistence and PDF Lifetime

The earlier workspace save path changed main-process memory before its disk write succeeded. The renderer could roll back after an error while the main process retained the rejected state. The new [workspace persistence service](../electron/workspace-persistence.cjs) validates and persists a snapshot before committing it in memory. [Failure tests](../tests/workspace-persistence.test.cjs) exercise this boundary.

The previous PDF session cache expired the first URL after five PDFs were opened. An isolated Electron reproduction confirmed that both annotation reads and saves then failed for that URL. Already saved annotation copies remained available. The new [PDF session service](../electron/pdf-sessions.cjs) preserves document handles and immutable temporary snapshots while limiting cached bytes. [Session tests](../tests/pdf-sessions.test.cjs) cover eviction and source replacement.

The [workbench cache](../src/workbench-cache.ts) keeps the active workbench and six recent idle workbenches. Dirty source buffers, active operations and pending PDF annotations protect a workbench from eviction. The terminal starts when its tab becomes visible. Intentionally started terminal processes remain available for reconnection; switching projects does not terminate experiments.

### PI Portfolio and Review Records

The [project model](../src/types.ts) adds an owner, task assignees and due dates, review requests, decisions, the last reviewed commit and a substantive-update timestamp. Existing projects remain valid without these fields.

The [review interface](../src/components/ProjectReview.tsx) selects a real Git history entry and stores its full commit identifier. Review requests distinguish the requested revision from the revision marked reviewed. Decisions can refer to the selected revision. The [overview inbox](../src/views/OverviewView.tsx) surfaces open reviews, blockers and due tasks with owner and update context.

The update timestamp records meaningful project-metadata edits, successful saves of changed source buffers and external content changes observed in the open source file. Navigation, unchanged saves and compilation alone do not advance it. It is an observed activity signal, not a repository-wide change log or filesystem monitor.

These records are personal coordination metadata. Names are free text; there is no shared identity directory or server-enforced task assignment. Editing a decision updates its record rather than producing an immutable decision history. A selected commit identifies source code, but does not attest that a displayed PDF was compiled from that commit. These limits matter when designing a later team review workflow.

### Portable Metadata, Calendars and Submission Snapshots

The [project-manifest service](../electron/project-portability.cjs) uses a versioned allowlist. It exports research metadata, tasks, review records, decisions and linked dates. It excludes local folder bindings, SSH settings, connection credentials, conversations and catalog source notes. The export interface explicitly says that project notes are included; users must review note contents before sharing.

Import validates the manifest and adds a separate project with fresh identifiers. Existing projects remain intact. Local files must be attached after import. This gives a predictable portability path without silently merging two people's workspace state.

Calendar export retains exact UTC instants for timed deadlines, including deadlines whose source timezone is AoE. Local task dates and milestones become all-day events. The exporter escapes text and folds UTF-8 lines. [Portability tests](../tests/project-portability.test.cjs) cover these properties and credential-bearing source URLs.

The [submission exporter](../electron/submission-export.cjs) produces a bundle of saved files with a manifest. It does not compile the manuscript. An existing PDF can predate the source, so the interface asks the researcher to save and compile before exporting. The bundle records this limitation rather than claiming a reproducible build that was not performed.

## Overleaf Collaboration

### Why a Git Companion Fits

Coauthors who already use Overleaf should be able to keep their existing project. Research Workbench adds local editing, project context, PDF feedback and a PI's portfolio view around that project. Its integration uses Overleaf's Git source interface. The [connection service](../electron/overleaf.cjs) and [dialog](../src/OverleafDialog.tsx) implement that boundary.

Source synchronization does not provide Overleaf's shared comments, tracked changes or live presence. Those remain in Overleaf. Publishing changed source can affect the relationship between source text and existing Overleaf feedback, so the interface exposes a review mode and a distinct publication action. Authentication uses a user's token stored outside project files; see [credential storage](../electron/overleaf-auth.cjs) and the linked [Overleaf authentication instructions](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/git-integration/git-integration-authentication-tokens).

This approach has a narrower implementation and compatibility surface than embedding a second collaborative editor or depending on undocumented browser requests. It also makes the local application useful when a collaborator never installs it.

### Explicit Synchronization Workflow

The intended sequence is:

1. Connect the project and choose review or publication mode.
2. Check remote changes and inspect the local/remote revision state.
3. Save or checkpoint local changes before preparing synchronization.
4. Prepare the merge in a separate staging worktree.
5. Review incoming changes and resolve conflicts explicitly.
6. Compile and inspect the proposed manuscript where the environment supports it.
7. Apply the reviewed result locally.
8. Publish separately, after checking that the reviewed revisions are still current.

The backend records transaction state and checks revision identities at the apply and publication boundaries. A changed remote or local revision requires another review. [Connector tests](../tests/overleaf.test.cjs) exercise the transaction machinery with local repositories. The [release smoke](../scripts/release-smoke.mjs) uses a synthetic local transport for desktop integration. Neither substitutes for a test against an actual eligible Overleaf account and a representative collaborative project.

The connection interface should explain account eligibility and token setup using current official documentation. Do not promise universal Git access for every account. ZIP-based handoff remains available by extracting an Overleaf source archive and opening its folder, but it is a manual handoff rather than synchronization.

## Architectural Boundaries

| Boundary                       | Current Responsibility                                                  | Direction                                                                       |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Renderer and application shell | Navigation, editable views, local drafts, review presentation           | Keep user intent and presentation here; avoid duplicating persistence authority |
| Workspace persistence          | Validated snapshots and serialized writes                               | Preserve a single authoritative committed state and test failed writes          |
| Project files and builds       | Rooted file access, external tools, compiler output                     | Keep filesystem and process work out of view components                         |
| PDF services                   | Document identity, cached bytes, annotation versions                    | Keep document lifetime separate from memory-cache eviction                      |
| Overleaf connector             | Credentials, transport, staged transactions, remote revision checks     | Keep source synchronization separate from project metadata and UI preferences   |
| Portable project manifest      | Explicitly shareable metadata                                           | Maintain schema versions and field allowlists; add migrations deliberately      |
| AI services                    | Account connection, agent execution, contextual tools, reviewed changes | Keep optional and isolate provider-specific behavior behind a stable interface  |

The implementation has begun these separations, but [main-process IPC registration](../electron/main.cjs), [App](../src/App.tsx), [Workbench](../src/Workbench.tsx) and [PdfReader](../src/PdfReader.tsx) still coordinate many responsibilities. Incremental extraction is preferable to a framework rewrite. Start with code that already has a clear state boundary and an executable failure test.

The preload bridge and renderer API types are still maintained separately. A shared contract can generate or validate both sides and expose consistent error types. Such work should preserve runtime validation; static types alone cannot validate imported files or IPC arguments.

## Remaining Priorities

### 1. Establish a Release People Can Install

Complete signing, notarization and installation checks on the declared architectures and oldest supported OS. Verify the packaged application's native helper and dependencies, not only the development checkout. Confirm that first launch works without TeX, an AI login or a pre-existing workspace. Follow the [release checklist](release.md).

Acceptance evidence: installation and first-use records from clean target environments; successful package verification; a tested upgrade and backup/restore path. CI configuration is useful infrastructure, but hosted CI must actually run before it counts as evidence.

### 2. Observe Real Researcher and PI Workflows

Run pilots with people who did not build the application. Include a researcher revising a paper, a PI reviewing several projects and a collaborator who continues using Overleaf. Observe where they hesitate, seek the terminal, misunderstand save/sync status or return to their previous tools.

Record whether they can complete a manuscript revision, respond to feedback and resume work later. Measure the observed task times, support requests and failures before setting numerical adoption or performance targets. The repository cannot establish product fit by feature count.

### 3. Validate the Collaboration Boundary

Test real token setup, project eligibility, proxy behavior and reconnection. Exercise concurrent collaborator changes, unresolved conflicts, moved files and interrupted publication. Preserve a separate publication step and make stale state actionable.

Acceptance evidence: the latest collaborator edit survives a failed or stale publish attempt; users can explain what is local and what has reached Overleaf; review mode cannot publish. Comments and tracked changes should be assessed with actual collaborators rather than assumed safe from source-only tests.

### 4. Strengthen Review Provenance and Team Sharing

Proposed: associate review requests with a source commit, build configuration and PDF hash together. Provide a read-only review bundle that a collaborator can inspect without installing the full application. Add attribution, threaded replies and structured decisions only after validating the handoff workflow.

A later shared project model should distinguish team notes from private PI notes. Machine-local folder mappings, account credentials and private conversations should remain outside shared manifests. Shared identity and authorization require explicit design; free-text owners do not provide either.

### 5. Benchmark Before Replacing Search

Current search scans folders and reloads some metadata on each request. PDF text has a bounded in-memory cache. Traversal limits protect the application, but can omit results from larger repositories; the worker reports those limits. See [search limits and cancellation](../electron/search-worker.cjs).

Measure cold and repeated searches on representative portfolios, including PDFs, code repositories and long conversation histories. Record latency, memory, completeness and cancellation behavior. If those results justify it, introduce a disposable incremental full-text index with persisted PDF text and page locations. Keep the index rebuildable; research files and annotations must remain authoritative.

### 6. Continue Modularization and Keep AI Optional

Proposed: extract editor-buffer, build-session and repository-operation services from the workbench as their state contracts become clear. Consolidate IPC definitions and document which operations can run concurrently. Keep source edits, builds, synchronization and backup mutually coordinated where they touch the same files.

An AI-provider interface should separate account authentication, model discovery, streaming, tool calls, permissions and change review. Implement another provider when an actual target user requires it and a supportable contract is available. Basic project, manuscript and PDF workflows should remain usable with AI disconnected.

### 7. Defer Cross-Platform Claims Until Tested

Electron gives the application a possible path to other operating systems, but the current release, native dictation, environment discovery and desktop assumptions are Mac-oriented. Windows and Linux need dedicated packaging, process management, credential storage, filesystem and end-to-end validation. Document them as future targets until those checks exist.

## Validation Record and Acceptance Scenarios

The full backend suite passed with 271 tests and no failures or skips on this Mac. TypeScript and Vite builds passed. The desktop suites passed for manuscript editing and compilation, Git operations, deadlines, PDF annotations, SyncTeX, and layout. A later focused SyncTeX run also verified that both navigation directions reject an older PDF after its source file changes.

The PI desktop smoke passed against a fresh synthetic profile, including revision-linked review records, exports, bounded idle views and on-demand terminals. The release smoke passed through empty first launch, the synthetic example, diagnostics, project metadata export, and a complete Overleaf workflow against a local Git fixture. That workflow exercised unsaved-draft protection, incoming and outgoing source review, actual LaTeX compilation, the reviewed PDF path, local application, and publication. The PI and Overleaf screenshots were inspected for layout problems.

These results do not establish live Overleaf access, preservation of online comments, a signed public release, or compatibility with every supported Mac. The integration guide and release guide specify the remaining account and distribution checks.

An unsigned Apple silicon DMG was built locally. Development-package validation, disk-image verification, and the packaged fresh-install/example/diagnostics/metadata-export smoke passed. The Intel helper cross-compiled, but the complete Intel application, macOS 13 hardware, hosted CI, and signing/notarization were not tested in this session.

The following scripts provide repeatable desktop acceptance scenarios:

- [PI workflow smoke](../scripts/pi-workflow-smoke.mjs): owner and task editing, review requests at full commit identifiers, reviewed revisions, decisions, overview inbox, metadata/calendar export, idle-view bounds and on-demand terminals.
- [Release smoke](../scripts/release-smoke.mjs): empty first launch, example import, diagnostics, portable export and the staged Overleaf workflow using a synthetic transport.
- [Existing desktop scripts](../package.json): manuscript editing, PDF annotations, SyncTeX, Git, backups/continuity and agent workflows.

Additional release acceptance scenarios should cover disk-full or denied writes; recovery after a crash; a project folder moved or disconnected; an external edit while the editor is dirty; annotating an older PDF after many project switches; and restoring a backup on another machine. Test outcomes belong to the exact build and environment tested. A successful synthetic workflow does not establish live-service compatibility or general user acceptance.
