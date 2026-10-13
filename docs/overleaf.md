# Collaborating With Overleaf

This guide is for a researcher using Research Workbench locally while coauthors continue in Overleaf. The connection transfers manuscript source through Overleaf's Git integration. Live presence, browser comments, and tracked-change threads remain in Overleaf.

## Before You Connect

The project needs eligible Overleaf Git access, usually through the project owner's premium subscription or institutional access. Confirm that **Integrations → Git** is available for the project. Overleaf currently uses `main` for new clones; older clones may use `master`. Workbench discovers the published branch instead of assuming either name. [Overleaf Git integration](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/git-integration)

Create your own Git authentication token in [Overleaf account settings](https://www.overleaf.com/user/settings). Overleaf requires a token rather than the ordinary account password. Collaborators should use their own accounts and tokens. [Token instructions](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/git-integration/git-integration-authentication-tokens)

This version connects to Overleaf Cloud project URLs. It does not yet configure a custom Server Pro host. You also need local Git. Local compilation requires a TeX installation; check **Workspace settings → Check your setup → Check tools** before a publication review.

## Connect a Manuscript

From the welcome screen, select **Connect Overleaf**, enter a project name, paste the Overleaf project URL, and provide your token. Choose a connection mode and select **Choose folder and clone**. The app creates a local Git checkout.

For an existing local project, use its Overleaf connection action. You can clone into a new folder or connect a Git repository whose history is related to the Overleaf project. An extracted source ZIP has no shared Git history. Clone first, then copy saved edits into the clone if you want to enable synchronization.

**Review** mode lets you retrieve and inspect source while publication remains disabled. Use this mode when the team is actively reviewing through Overleaf comments or tracked changes. **Write and publish** mode enables the explicit reviewed publication flow; switching modes does not send manuscript changes.

Tokens are encrypted through the operating system credential storage and kept outside manuscript files. Workspace exports and complete backups exclude them. After restoring on another Mac, reconnect with your own token. **Connection settings → Update token** replaces an expired or revoked credential; disconnecting keeps local files.

## Retrieve and Review Coauthor Changes

1. Save editor changes to disk. Save and commit are separate actions.
2. If the connection lists uncommitted changes, select the intended files, enter a checkpoint message, and choose **Commit selected source**. Complete or remove remaining uncommitted changes before preparing the review.
3. Select **Check coauthor changes**, then **Review incoming and local changes**.
4. Inspect the incoming and proposed publication differences. Resolve conflicts by choosing local, Overleaf, common-base, or edited merged text as appropriate.
5. Select **Compile review**, then **Open reviewed PDF** to inspect the actual proposed manuscript in the app's PDF preview.
6. Select **Apply reviewed source locally** when satisfied. This applies the reviewed revision to the local checkout; publication remains a separate action.

These actions use an isolated review checkout and record the revisions being reviewed. If the local or remote state changes, restart the review rather than assuming a previous preview represents the new source. The connection does not continuously poll Overleaf in the background.

## Publish Deliberately

In **Write and publish** mode, compile the reviewed revision successfully and inspect its source and PDF. Confirm that the team is ready, acknowledge the comment/track-change caveat, and choose **Publish reviewed source**. The app checks the expected local and remote revisions before sending the reviewed source. It does not force-push over a collaborator's newer revision.

Overleaf warns that Git pushes can lose or displace comments and tracked changes. File moves and renames can also discard associated review metadata. Agree on a handoff with coauthors before publishing from a local client. [Overleaf's limitations](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/git-integration#known-limitations)

A successful local build does not certify an identical Overleaf PDF. Match the main file and compiler, record the TeX Live version, and check required fonts and packages. Workbench's **Open in Overleaf** action lets you confirm the cloud build after publication. The local review does not download or validate Overleaf's compiled PDF.

## Other Collaboration Paths

**Source ZIP:** download the project's source from Overleaf, extract it, and choose **Open a folder**. You can edit, compile, annotate, and export a submission snapshot without Git integration. ZIP import is a one-time copy; later changes require an explicit exchange with collaborators.

**GitHub synchronization:** a team can use Overleaf's separate GitHub integration and Workbench's ordinary Git tools. Overleaf's GitHub push/pull actions are manual, not continuous synchronization. Establish one agreed publication path to avoid overlapping local, GitHub, and Overleaf edits. [Overleaf GitHub synchronization](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/github-synchronization)

**Submission snapshot:** save the manuscript, then export a submission snapshot from the project. The directory contains source, references and assets, the existing compiled PDF when present, and a checksum manifest. Export does not run a compiler and does not guarantee that an existing PDF matches the current source. Inspect skipped files, private text, and venue requirements before sharing it.
