import { useState, type ReactNode } from "react";
import {
  Check,
  ChevronRight,
  FileText,
  LoaderCircle,
  TerminalSquare,
} from "lucide-react";
import type { AIMessage } from "./types";
import { plural } from "./components/ui";

// A section renders its contents once first opened, so long transcripts keep
// command output and diffs out of the page until someone looks at them.
function Disclosure({
  className,
  summary,
  children,
}: {
  className: string;
  summary: ReactNode;
  children: ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className={className}
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      {summary}
      {opened && children}
    </details>
  );
}

export default function AIActivityLog({
  message,
  changedFileCount,
  openReference,
}: {
  message: AIMessage;
  changedFileCount: number;
  openReference(reference: string): void;
}) {
  const activities = message.activities || [];
  if (!activities.length && !message.plan?.length) return null;
  const commands = activities.filter(
    (activity) => activity.type === "commandExecution",
  );
  const running = message.status === "running";
  const active = [...activities]
    .reverse()
    .find((activity) => activity.status === "inProgress");
  const counts = [
    commands.length ? plural(commands.length, "command") : "",
    changedFileCount ? `${plural(changedFileCount, "file")} changed` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Disclosure
      className="ai-work-log"
      summary={
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
      }
    >
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
          <Disclosure
            className={`ai-activity ${activity.status}`}
            key={activity.id}
            summary={
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
            }
          >
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
          </Disclosure>
        ))}
      </div>
    </Disclosure>
  );
}
