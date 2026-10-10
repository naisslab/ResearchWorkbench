import { memo } from "react";
import { ListTodo } from "lucide-react";
import type {
  Navigate,
  Project,
  Stage,
  UpdateProject,
  Workspace,
} from "../types";
import { stageName, stages } from "../types";
import { AreaIcon } from "../ResearchIcons";
import { Options } from "../components/ui";

export default memo(function BoardView({
  state,
  projects,
  area,
  navigate,
  update,
}: {
  state: Workspace;
  projects: Project[];
  area: string;
  navigate: Navigate;
  update: UpdateProject;
}) {
  const areas = new Map(state.areas.map((a) => [a.id, a]));
  const visible = projects.filter((p) => area === "all" || p.areaId === area);
  const move = (id: string, stage: Stage) => {
    if (state.projects.some((p) => p.id === id && p.stage !== stage))
      void update(id, { stage });
  };
  return (
    <div className="board">
      {stages.map(({ id: stage }) => {
        const list = visible.filter((p) => p.stage === stage);
        return (
          <section
            className="board-column"
            key={stage}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              move(e.dataTransfer.getData("text/project-id"), stage);
            }}
          >
            <div className="board-heading" data-stage={stage}>
              <i />
              <h3>{stageName[stage]}</h3>
              <span>{list.length}</span>
            </div>
            <div className="board-cards">
              {list.map((p) => {
                const done = p.tasks.filter((t) => t.done).length;
                const cardArea = areas.get(p.areaId);
                return (
                  <div
                    className="board-card"
                    draggable
                    key={p.id}
                    style={
                      {
                        "--area-color": cardArea?.color,
                      } as React.CSSProperties
                    }
                    onDragStart={(e) =>
                      e.dataTransfer.setData("text/project-id", p.id)
                    }
                  >
                    <button
                      className="board-card-main"
                      onClick={() => navigate("details", { projectId: p.id })}
                    >
                      <span className="card-area">
                        <AreaIcon area={cardArea} size={12} />
                        {cardArea?.name}
                      </span>
                      <h3>{p.name}</h3>
                      <p>{p.summary}</p>
                    </button>
                    <div className="board-card-footer">
                      {p.tasks.length > 0 && (
                        <span>
                          <ListTodo size={12} />
                          {done}/{p.tasks.length}
                        </span>
                      )}
                      <select
                        aria-label={`Stage for ${p.name}`}
                        value={p.stage}
                        onChange={(e) => move(p.id, e.target.value as Stage)}
                      >
                        <Options items={stages} />
                      </select>
                    </div>
                  </div>
                );
              })}
              {!list.length && (
                <div className="board-drop-zone">Drop a project here</div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
});
