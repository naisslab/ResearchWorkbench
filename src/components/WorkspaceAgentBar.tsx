import { useState } from "react";
import AIPanel from "../AIPanel";
import Modal from "../Modal";
import type { Project, SearchHit } from "../types";
import { workspaceAgentProject } from "../workspace-agent";
import "../workspace-agent.css";

export default function WorkspaceAgentBar({
  projects,
  currentProject,
  initialQuery,
  close,
  open,
  openResult,
}: {
  projects: Project[];
  currentProject?: Project;
  initialQuery: string;
  close(): void;
  open(id: string): void;
  openResult(hit: SearchHit): void;
}) {
  const [request] = useState(() =>
    initialQuery
      ? { draft: initialQuery, nonce: Date.now(), append: true }
      : undefined,
  );
  async function openReference(
    reference: string,
    _rootId: string,
    action: "open" | "reveal" = "open",
  ) {
    if (!reference.startsWith("workspace/"))
      throw new Error("Search for this source in your workspace.");
    const url = new URL(reference, "https://workbench.local/");
    const projectId = decodeURIComponent(
      url.pathname.slice("/workspace/".length),
    );
    const project = projects.find((p) => p.id === projectId);
    if (!project) throw new Error("The source project no longer exists.");
    const fields = url.searchParams;
    if (action === "reveal")
      return window.research!.revealFolder(
        projectId,
        fields.get("rootId") || "primary",
        fields.get("file") || undefined,
      );
    const kind = fields.get("kind") as SearchHit["kind"];
    if (!kind || kind === "project") return open(projectId);
    if (!["file", "pdf", "annotation", "chat"].includes(kind))
      throw new Error("Invalid source reference.");
    const position = (key: string) => {
      const value = Number(fields.get(key));
      return Number.isInteger(value) && value > 0 ? value : undefined;
    };
    openResult({
      id: crypto.randomUUID(),
      projectId,
      projectName: project.name,
      kind,
      title: fields.get("file") || project.name,
      snippet: "",
      file: fields.get("file") || undefined,
      rootId: fields.get("rootId") || "primary",
      line: position("line"),
      page: position("page"),
      documentKey: fields.get("documentKey") || undefined,
      version: fields.get("version") || undefined,
      chatId: fields.get("chatId") || undefined,
      messageId: fields.get("messageId") || undefined,
    });
  }
  return (
    <Modal title="Workspace" onClose={close} className="workspace-agent-modal">
      <div className="workspace-agent-scope">
        <span>All projects</span>
        {currentProject && <span>Current project: {currentProject.name}</span>}
      </div>
      <div className="workspace-agent-panel">
        <AIPanel
          project={workspaceAgentProject}
          file=""
          rootId="primary"
          hasText={false}
          hasSelection={false}
          readText={() => ""}
          dirty={false}
          prepare={async () => {}}
          onRunning={() => {}}
          onFilesChanged={async () => {}}
          onOpenReference={openReference}
          workspaceContext={{
            projectId: currentProject?.id,
            projectName: currentProject?.name,
          }}
          workspaceSearch={{ projects, open, openResult, close }}
          visible
          request={request}
        />
      </div>
    </Modal>
  );
}
