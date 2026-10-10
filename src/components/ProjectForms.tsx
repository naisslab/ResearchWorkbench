import { useState } from "react";
import { ArrowRight } from "lucide-react";
import type { Area, Project, Stage } from "../types";
import { stages } from "../types";
import Modal from "../Modal";
import { Options, plural } from "./ui";

export function NewProject({
  areas,
  areaId,
  close,
  create,
}: {
  areas: Area[];
  areaId: string;
  close(): void;
  create(p: Project): Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [area, setArea] = useState(areaId);
  const [stage, setStage] = useState<Stage>("exploration");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="A place for your next idea" onClose={close} locked={busy}>
      <p className="muted">
        Start a project. Add files, tasks, and paper dates as it grows.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          // The form stays open, and usable again, when the save fails.
          const created = await create({
            id: crypto.randomUUID(),
            name: name.trim(),
            summary,
            areaId: area,
            stage,
            folder: "",
            mainFile: "",
            sshHost: "",
            venue: "",
            notes: "",
            tasks: [],
            deadlines: [],
            updatedAt: new Date().toISOString(),
          });
          if (!created) setBusy(false);
        }}
      >
        <label>
          Project name
          <input
            placeholder="e.g. Learning to Schedule"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
          />
        </label>
        <label>
          Research question or short description
          <textarea
            placeholder="What are you trying to understand or build?"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
          />
        </label>
        <div className="form-grid">
          <label>
            Research area
            <select
              value={area}
              onChange={(e) => setArea(e.target.value)}
              required
            >
              <Options items={areas} />
            </select>
          </label>
          <label>
            Current stage
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value as Stage)}
            >
              <Options items={stages} />
            </select>
          </label>
        </div>
        <div className="modal-actions">
          <button
            className="button primary"
            disabled={busy || !name.trim() || !area}
          >
            {busy ? "Creating…" : "Create project"}
            <ArrowRight size={14} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function RemoveProject({
  project: p,
  close,
  remove,
}: {
  project: Project;
  close(): void;
  remove(): void;
}) {
  const lost = [
    plural(p.tasks.length, "task"),
    plural(p.deadlines.length, "milestone"),
    p.notes.trim() && "the research notes",
  ].filter(Boolean);
  return (
    <Modal title={`Remove “${p.name}”?`} onClose={close}>
      <p className="muted">
        This removes {lost.slice(0, -1).join(", ")} and {lost.at(-1)} from the
        workspace. Files in the project folder stay on disk, and you can undo
        right after.
      </p>
      <div className="modal-actions">
        <button className="button" onClick={close}>
          Cancel
        </button>
        <button className="button primary danger" onClick={remove}>
          Remove project
        </button>
      </div>
    </Modal>
  );
}
