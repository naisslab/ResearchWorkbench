import type { Workspace } from "./types";
export interface WritingCapture {
  tasks: string[];
  note: string;
}

export function applyWritingCapture(
  state: Workspace,
  projectId: string,
  capture: WritingCapture,
): Workspace {
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) throw new Error("The project no longer exists.");
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
    !("\n\n" + project.notes.trim() + "\n\n").includes("\n\n" + note + "\n\n");
  return {
    ...state,
    projects: state.projects.map((p) =>
      p.id !== projectId
        ? p
        : {
            ...p,
            tasks: [...p.tasks, ...tasks],
            notes: addNote
              ? [p.notes.trimEnd(), note].filter(Boolean).join("\n\n")
              : p.notes,
            updatedAt: new Date().toISOString(),
          },
    ),
  };
}
