import type { DeadlineKind, Project, Stage, Workspace } from "./types";
import { readManuscript } from "./latex-project.ts";
import { bibliographyProblems, parseBibliography } from "./bibliography.ts";
import { bibliographyFiles } from "./useBibliography.ts";
import { referencesLocation, submissionChecks } from "./submission.ts";

// Agent tools that run in the window (see electron/agent-tools.cjs). The main
// process validates their input; these functions apply it.

export interface WritingCapture {
  tasks: string[];
  note: string;
}
export interface ProjectUpdate {
  tasks: { id: string; status: "done" | "open" | "blocked"; reason: string }[];
  stage: Stage | "";
  milestones: { label: string; date: string; kind: DeadlineKind }[];
}

function withProject(
  state: Workspace,
  projectId: string,
  change: (project: Project) => Partial<Project>,
): Workspace {
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) throw new Error("The project no longer exists.");
  return {
    ...state,
    projects: state.projects.map((p) =>
      p.id === projectId
        ? { ...p, ...change(p), updatedAt: new Date().toISOString() }
        : p,
    ),
  };
}

export function applyWritingCapture(
  state: Workspace,
  projectId: string,
  capture: WritingCapture,
): Workspace {
  return withProject(state, projectId, (project) => {
    const known = new Set(
      project.tasks.map((t) => t.text.trim().toLocaleLowerCase()),
    );
    const tasks = capture.tasks.flatMap((text) => {
      const key = text.trim().toLocaleLowerCase();
      if (known.has(key)) return [];
      known.add(key);
      return [{ id: crypto.randomUUID(), text: text.trim(), done: false }];
    });
    const note = capture.note.trim();
    const addNote =
      note &&
      !("\n\n" + project.notes.trim() + "\n\n").includes(
        "\n\n" + note + "\n\n",
      );
    return {
      tasks: [...project.tasks, ...tasks],
      notes: addNote
        ? [project.notes.trimEnd(), note].filter(Boolean).join("\n\n")
        : project.notes,
    };
  });
}

/** Task statuses, stage and milestones; a repeated milestone is not added twice. */
export function applyProjectUpdate(
  state: Workspace,
  projectId: string,
  update: ProjectUpdate,
) {
  const result = { tasks: 0, stage: "" as Stage | "", milestones: 0 };
  const next = withProject(state, projectId, (project) => {
    const missing = update.tasks.find(
      (change) => !project.tasks.some((task) => task.id === change.id),
    );
    if (missing)
      throw new Error(
        `No to-do has id ${missing.id}. Use ids from the project tasks.`,
      );
    const tasks = project.tasks.map((task) => {
      const change = update.tasks.find((c) => c.id === task.id);
      if (!change) return task;
      result.tasks++;
      const { blocked: _, ...rest } = task;
      return change.status === "blocked"
        ? { ...rest, done: false, blocked: change.reason }
        : { ...rest, done: change.status === "done" };
    });
    const milestones = update.milestones
      .filter(
        (m) =>
          !project.deadlines.some(
            (d) => d.label === m.label && d.date === m.date,
          ),
      )
      .map((m) => ({ id: crypto.randomUUID(), ...m }));
    result.milestones = milestones.length;
    if (update.stage && update.stage !== project.stage)
      result.stage = update.stage;
    return {
      tasks,
      stage: update.stage || project.stage,
      deadlines: [...project.deadlines, ...milestones],
    };
  });
  return { state: next, result };
}

/**
 * The Build log's bibliography checks and the submission checks, read from
 * the files on disk and the compiled PDF rather than the editor's state, so
 * they reflect edits the agent just made.
 */
export async function manuscriptChecks(project: Project) {
  if (!project.folder || !/\.(tex|ltx)$/.test(project.mainFile || ""))
    throw new Error(
      "Set the project folder and LaTeX entry file in project details first.",
    );
  const api = window.research!;
  const read = (file: string) => api.readFile(project.id, file, "primary");
  const sources = await readManuscript(project.mainFile, (file) =>
    read(file).then(
      (text) => ({ file, text }),
      () => null,
    ),
  );
  if (!sources.length)
    throw new Error(`${project.mainFile} could not be read.`);
  const roots = await api.projectFiles(project.id);
  const bib = bibliographyFiles(
    sources,
    project.mainFile,
    roots.find((root) => root.id === "primary"),
  );
  const unreadable = [...bib.missing];
  const entries = (
    await Promise.all(
      bib.files.map((file) =>
        read(file).then(
          (text) => parseBibliography(text, file),
          (error: Error) => {
            unreadable.push({
              file,
              message: `${file} could not be read, so citations are not checked: ${error.message}`,
            });
            return [];
          },
        ),
      ),
    )
  ).flat();
  const facts = await api.pdfReport(
    project.id,
    project.pageLimit ? referencesLocation(sources) : null,
  );
  return {
    checks: facts
      ? submissionChecks(facts, sources, {
          pageLimit: project.pageLimit,
          anonymous: project.anonymousReview,
        })
      : null,
    ...(!facts && {
      note: "No compiled PDF yet: compile the manuscript, then check again for page, font, and anonymity checks.",
    }),
    problems: bibliographyProblems(entries, sources, [], unreadable),
  };
}
