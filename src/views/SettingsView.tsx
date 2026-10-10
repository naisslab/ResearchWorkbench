import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bell,
  FolderOpen,
  Layers3,
  Monitor,
  Moon,
  Plus,
  Sun,
  Trash2,
} from "lucide-react";
import type { Commit, Workspace } from "../types";
import { BlurField, plural } from "../components/ui";
import { exclusive } from "../workspace-lock";

const appearances = [
  { id: "light", name: "Light", icon: Sun },
  { id: "dark", name: "Dark", icon: Moon },
  { id: "system", name: "System", icon: Monitor },
] as const;

export default function SettingsView({
  state,
  info,
  commit,
  report,
  notify,
  imported,
}: {
  state: Workspace;
  info?: { dataPath: string; version: string };
  commit: Commit;
  report(message: string): void;
  notify(message: string): void;
  imported(state: Workspace): void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#75a6d9");
  const setAreas = (
    change: (areas: Workspace["areas"]) => Workspace["areas"],
  ) => void commit((s) => ({ ...s, areas: change(s.areas) }));
  const run = async (task: () => Promise<unknown>) => {
    try {
      await task();
    } catch (e) {
      report((e as Error).message);
    }
  };
  return (
    <div className="settings-layout">
      <section className="detail-card">
        <div className="section-heading">
          <h2>
            <Sun size={17} />
            Appearance
          </h2>
        </div>
        <p className="muted">
          Choose a theme for the workspace, editor and terminal.
        </p>
        <div className="appearance-options">
          {appearances.map(({ id, name, icon: Glyph }) => (
            <button
              key={id}
              aria-pressed={(state.appearance || "system") === id}
              className="appearance-option"
              onClick={() => void commit((s) => ({ ...s, appearance: id }))}
            >
              <Glyph size={14} />
              {name}
            </button>
          ))}
        </div>
      </section>
      <section className="detail-card">
        <div className="section-heading">
          <h2>
            <Bell size={17} /> Reminders
          </h2>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={state.deadlineReminders !== false}
            onChange={(event) => {
              const deadlineReminders = event.target.checked;
              void commit((s) => ({ ...s, deadlineReminders }));
            }}
          />
          Notify me a week and a day before each upcoming date
        </label>
        <p className="form-help">
          Covers My dates and project milestones while the app is open, even
          with its window closed. Finished dates are skipped.
        </p>
      </section>
      <section className="detail-card">
        <div className="section-heading">
          <h2>
            <Layers3 size={17} /> Research areas
          </h2>
        </div>
        <p className="muted">
          Organize projects around your research interests.
        </p>
        <div className="settings-areas">
          {state.areas.map((a) => {
            const count = state.projects.filter(
              (p) => p.areaId === a.id,
            ).length;
            return (
              <div key={a.id}>
                <i style={{ "--area-color": a.color } as React.CSSProperties} />
                <BlurField
                  aria-label={`Rename ${a.name}`}
                  value={a.name}
                  required
                  onCommit={(name) =>
                    setAreas((areas) =>
                      areas.map((item) =>
                        item.id === a.id ? { ...item, name } : item,
                      ),
                    )
                  }
                />
                <span>{plural(count, "project")}</span>
                <button
                  className="icon-button"
                  title="Remove empty area"
                  disabled={count > 0 || state.areas.length === 1}
                  onClick={() =>
                    setAreas((areas) =>
                      areas.filter((item) => item.id !== a.id),
                    )
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
        <form
          className="area-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            setAreas((areas) => [
              ...areas,
              {
                id: crypto.randomUUID(),
                name: name.trim(),
                color,
                icon: "layers",
              },
            ]);
            setName("");
          }}
        >
          <input
            type="color"
            aria-label="Research area color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
          <input
            aria-label="New research area"
            placeholder="New research area…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="button" disabled={!name.trim()}>
            <Plus size={14} /> Add area
          </button>
        </form>
        <p className="form-help">
          Move an area’s projects elsewhere before removing the area.
        </p>
      </section>
      <section className="detail-card">
        <div className="section-heading">
          <h2>
            <FolderOpen size={17} /> Your data, on your Mac
          </h2>
          <span className="sample-tag">LOCAL FIRST</span>
        </div>
        <p className="muted">
          Project metadata, notes, tasks, and dates are stored as JSON. Your
          manuscript stays in its project folder.
        </p>
        <div className="data-path">
          {info?.dataPath || "Loading storage location…"}
        </div>
        <div className="backup-actions">
          <button
            className="button"
            onClick={() =>
              run(async () => {
                if (await window.research!.exportWorkspace())
                  notify(
                    "Workspace exported. Project files are stored separately.",
                  );
              })
            }
          >
            <ArrowDownToLine size={16} /> Export workspace
          </button>
          <button
            className="button"
            onClick={() =>
              run(() =>
                exclusive(async () => {
                  const next = await window.research!.importWorkspace();
                  if (!next) return;
                  imported(next);
                  notify(
                    "Workspace imported. The previous workspace was backed up.",
                  );
                }),
              )
            }
          >
            <ArrowUpFromLine size={16} /> Import workspace
          </button>
        </div>
        <p className="form-help">
          Exports contain metadata and local folder paths. Back up your project
          folders separately.
        </p>
        {info && (
          <p className="form-help">Research Workbench v{info.version}</p>
        )}
      </section>
    </div>
  );
}
