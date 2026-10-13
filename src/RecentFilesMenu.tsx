import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Clock3, FileText } from "lucide-react";
import type { ProjectFileRoot } from "./types";
import { useWorkbenchVisible } from "./WorkbenchVisibility";

export default function RecentFilesMenu({
  items,
  roots,
  activeFile,
  activeRoot,
  openFile,
}: {
  items: { rootId: string; file: string }[];
  roots: ProjectFileRoot[];
  activeFile: string;
  activeRoot: string;
  openFile(file: string, rootId: string): void;
}) {
  const id = useId();
  const visible = useWorkbenchVisible();
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  function close() {
    menu.current?.hidePopover();
  }
  useEffect(() => {
    if (!visible) close();
  }, [visible]);
  useEffect(() => {
    if (!expanded) return;
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [expanded]);
  function show(last = false) {
    const node = menu.current!;
    const box = trigger.current!.getBoundingClientRect();
    node.style.left = `${Math.max(8, Math.min(box.left, innerWidth - 348))}px`;
    node.style.top = `${box.bottom + 6}px`;
    node.style.maxHeight = `${Math.min(400, innerHeight - box.bottom - 14)}px`;
    node.showPopover();
    const buttons =
      node.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    buttons[last ? buttons.length - 1 : 0]?.focus();
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="recent-files-trigger"
        aria-label="Recent files"
        aria-haspopup="menu"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() =>
          menu.current?.matches(":popover-open") ? close() : show()
        }
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show(event.key === "ArrowUp");
          }
        }}
      >
        <Clock3 size={14} />
        <span>Recent files</span>
        <ChevronDown size={12} />
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        className="recent-files-menu"
        role="menu"
        aria-label="Recently opened files"
        onToggle={(event) =>
          setExpanded(event.currentTarget.matches(":popover-open"))
        }
        onKeyDown={(event) => {
          if (event.key === "Escape" || event.key === "Tab") {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
            }
            close();
            trigger.current?.focus();
            return;
          }
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role="menuitem"]',
            ),
          ];
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "ArrowDown"
              ? (index + 1) % buttons.length
              : event.key === "ArrowUp"
                ? (index - 1 + buttons.length) % buttons.length
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : -1;
          if (next >= 0) {
            event.preventDefault();
            buttons[next]?.focus();
          }
        }}
      >
        <div className="recent-files-heading" aria-hidden="true">
          Recently opened<span>{items.length}</span>
        </div>
        <div className="recent-files-list" role="none">
          {items.map((item) => {
            const parts = item.file.split("/");
            const name = parts.pop();
            const location = [
              roots.find((root) => root.id === item.rootId)?.label ||
                item.rootId,
              parts.join("/"),
            ]
              .filter(Boolean)
              .join(" / ");
            const current =
              item.file === activeFile && item.rootId === activeRoot;
            return (
              <button
                key={`${item.rootId}:${item.file}`}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-current={current ? "page" : undefined}
                title={`${location} / ${name}`}
                onClick={() => {
                  close();
                  trigger.current?.focus();
                  openFile(item.file, item.rootId);
                }}
              >
                <FileText size={16} />
                <span>
                  <strong>{name}</strong>
                  <small>{location}</small>
                </span>
                {current && <Check size={14} className="recent-file-current" />}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
