import {
  Check,
  ChevronRight,
  FileText,
  LoaderCircle,
  TerminalSquare,
} from "lucide-react";
import type { AIMessage } from "./types";
import { plural } from "./components/ui";

export default function AIActivityLog({
  message,
  openReference,
}: {
  message: AIMessage;
  openReference(reference: string): void;
}) {
  const activities = message.activities || [];
  if (!activities.length && !message.plan?.length) return null;
  const commands = activities.filter(
    (activity) => activity.type === "commandExecution",
  );
  const files = new Set(
    activities.flatMap(
      (activity) => activity.changes?.map((change) => change.path) || [],
    ),
  );
  const running = message.status === "running";
  const active = [...activities]
    .reverse()
    .find((activity) => activity.status === "inProgress");
  const counts = [
    commands.length ? plural(commands.length, "command") : "",
    files.size ? `${plural(files.size, "file")} changed` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <details className="ai-work-log">
      <summary>
        {running ? (
          <LoaderCircle size={13} className="spin" />
        ) : (
          <Check size={13} />
        )}
        <span>
          {running
            ? message.approvals?.length
              ? "Waiting for approval"
              : "Working"
            : "Work log"}
        </span>
        <small>
          {running && active
            ? active.command?.split("\n")[0] || active.type
            : counts}
        </small>
        <ChevronRight size={12} className="ai-disclosure" />
      </summary>
      <div className="ai-work-log-content">
        {message.plan?.length ? (
          <ul className="ai-plan">
            {message.plan.map((step, index) => (
              <li key={index} className={step.status}>
                <span>
                  {step.status === "completed"
                    ? "✓"
                    : step.status === "inProgress"
                      ? "›"
                      : "○"}
                </span>
                {step.step}
              </li>
            ))}
          </ul>
        ) : null}
        {activities.map((activity) => (
          <details
            className={`ai-activity ${activity.status}`}
            key={activity.id}
          >
            <summary>
              {activity.type === "commandExecution" ? (
                <TerminalSquare size={12} />
              ) : (
                <FileText size={12} />
              )}
              <span>
                {activity.type === "commandExecution"
                  ? activity.command
                  : activity.type === "fileChange"
                    ? `${activity.changes?.length || 0} file changes`
                    : activity.text || activity.type}
              </span>
              <small className={activity.exitCode ? "ai-exit-error" : ""}>
                {activity.status === "inProgress"
                  ? "Running"
                  : activity.exitCode !== undefined
                    ? activity.exitCode === 0
                      ? "Passed"
                      : `Exit ${activity.exitCode}`
                    : activity.status}
              </small>
              <ChevronRight size={11} className="ai-disclosure" />
            </summary>
            {activity.cwd && (
              <small className="ai-command-cwd">{activity.cwd}</small>
            )}
            {activity.output && <pre>{activity.output}</pre>}
            {activity.changes?.map((change, index) => (
              <div className="ai-file-change" key={index}>
                <button
                  type="button"
                  title={`Open ${change.path}`}
                  onClick={() => openReference(change.path)}
                >
                  <FileText size={12} />
                  {change.path}
                </button>
                <pre>{change.diff}</pre>
              </div>
            ))}
          </details>
        ))}
      </div>
    </details>
  );
}
