import type { Project, Task, Workspace } from "./types";

export const WORKSPACE_AGENT_ID = "workspace-agent";
export const workspaceAgentProject: Project = {
  id: WORKSPACE_AGENT_ID,
  name: "Workspace agent",
  areaId: "",
  summary: "",
  stage: "exploration",
  folder: "",
  mainFile: "",
  sshHost: "",
  venue: "",
  notes: "",
  tasks: [],
  deadlines: [],
  updatedAt: "",
};
export interface WorkspaceOperation {
  entity: "project" | "task" | "milestone" | "deadline" | "area" | "settings";
  action: "create" | "update" | "remove";
  projectId: string;
  id: string;
  changes: Record<string, string | boolean | string[]>;
}
export interface WorkspaceMutation {
  operations: WorkspaceOperation[];
}

/** Apply the batch to a copy of the latest state; a failed operation saves nothing. */
export function applyWorkspaceMutation(
  state: Workspace,
  input: WorkspaceMutation,
) {
  const next = structuredClone(state);
  const changes: {
    entity: string;
    action: string;
    id: string;
    projectId?: string;
  }[] = [];
  const requireValue = (value: unknown, label: string) => {
    if (typeof value !== "string" || !value.trim())
      throw new Error(`Provide ${label}.`);
    return value;
  };
  const project = (id: string) => {
    const p = next.projects.find((p) => p.id === id);
    if (!p)
      throw new Error(
        `Project ${id} no longer exists. Read the workspace again.`,
      );
    return p;
  };
  for (const operation of input.operations) {
    const { entity, action, projectId, changes: patch } = operation;
    const id = action === "create" ? crypto.randomUUID() : operation.id;
    let items: { id: string }[];
    let defaults: object = {};
    if (entity === "settings") {
      Object.assign(next, patch);
      changes.push({ entity, action, id: "" });
      continue;
    }
    if (entity === "project") {
      items = next.projects;
      if (action === "create") {
        requireValue(patch.name, "a project name");
        requireValue(patch.areaId, "a research area id");
        defaults = {
          summary: "",
          notes: "",
          venue: "",
          folder: "",
          mainFile: "",
          sshHost: "",
          tasks: [],
          deadlines: [],
          stage: "exploration",
        };
      }
      if (patch.areaId && !next.areas.some((area) => area.id === patch.areaId))
        throw new Error("The research area no longer exists.");
    } else if (entity === "area") {
      items = next.areas;
      defaults = { icon: "folder" };
      if (action === "create") {
        requireValue(patch.name, "an area name");
        requireValue(patch.color, "an area color");
      }
      if (action === "remove" && next.projects.some((p) => p.areaId === id))
        throw new Error("Move the area's projects before removing it.");
    } else if (entity === "deadline") {
      items = next.trackedDeadlines ??= [];
      defaults = {
        subtitle: "",
        category: "other",
        kind: "other",
        status: "notStarted",
        source: "manual",
      };
      if (action === "create") {
        requireValue(patch.label, "a deadline label");
        requireValue(patch.time, "a deadline time");
        requireValue(patch.timezone, "a deadline timezone");
      }
      if (Array.isArray(patch.projectIds)) patch.projectIds.forEach(project);
    } else {
      const p = project(projectId);
      p.updatedAt = new Date().toISOString();
      items = entity === "task" ? p.tasks : p.deadlines;
      defaults = entity === "task" ? { done: false } : { kind: "other" };
      if (action === "create") {
        requireValue(
          patch[entity === "task" ? "text" : "label"],
          entity === "task" ? "to-do text" : "a milestone label",
        );
        if (entity === "milestone")
          requireValue(patch.date, "a milestone date");
      }
    }
    const index = items.findIndex((item) => item.id === id);
    if (action !== "create" && index < 0)
      throw new Error(
        `The ${entity} no longer exists. Read the workspace again.`,
      );
    if (action === "remove") {
      items.splice(index, 1);
      if (entity === "project") {
        next.projectOrder = next.projectOrder?.filter((key) => key !== id);
        next.trackedDeadlines = (next.trackedDeadlines || []).map((date) => {
          const { projectId: legacy, ...rest } = date;
          return {
            ...rest,
            ...(legacy && legacy !== id ? { projectId: legacy } : {}),
            ...(date.projectIds && {
              projectIds: date.projectIds.filter((key) => key !== id),
            }),
          };
        });
      }
    } else {
      const item = {
        ...(action === "create" ? defaults : items[index]),
        ...patch,
        id,
      };
      if (entity === "project")
        (item as Project).updatedAt = new Date().toISOString();
      if (entity === "task") {
        const task = item as Task & { status?: string; reason?: string };
        if (patch.status) {
          task.done = patch.status === "done";
          if (patch.status === "blocked") task.blocked = String(patch.reason);
          else delete task.blocked;
        }
        delete task.status;
        delete task.reason;
      }
      if (action === "create") items.push(item);
      else items[index] = item;
    }
    changes.push({ entity, action, id, ...(projectId && { projectId }) });
  }
  return { state: next, result: { changes } };
}
