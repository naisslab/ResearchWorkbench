import {
  memo,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  X,
} from "lucide-react";
import type { ProjectFileRoot } from "./types";
import { SearchField } from "./components/ui";
export type FileAction = "create" | "rename" | "trash" | "reveal" | "entry";
interface MenuTarget {
  rootId: string;
  /** Relative to the root; "" is the root itself. */
  path: string;
  folder: boolean;
}
interface FileNode {
  name: string;
  path: string;
  children?: FileNode[];
}
/** Folders sort before files, so rendering only maps. */
function tree(files: string[]) {
  const top: FileNode[] = [];
  const folders = new Map<string, FileNode[]>([["", top]]);
  for (const file of files) {
    const parts = file.split("/");
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join("/");
      if (folders.has(path)) return;
      const node: FileNode = { name, path };
      if (index < parts.length - 1) folders.set(path, (node.children = []));
      folders.get(parts.slice(0, index).join("/"))!.push(node);
    });
  }
  for (const nodes of folders.values())
    nodes.sort(
      (a, b) =>
        Number(!!b.children) - Number(!!a.children) ||
        a.name.localeCompare(b.name),
    );
  return top;
}
export default memo(function ProjectFiles({
  projectId,
  roots,
  active,
  activeRoot,
  mainFile,
  open,
  remove,
  act,
}: {
  projectId: string;
  roots: ProjectFileRoot[];
  active: string;
  activeRoot: string;
  mainFile: string;
  open(file: string, rootId: string): void;
  remove(rootId: string): void;
  act(action: FileAction, rootId: string, path: string): void;
}) {
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<
    MenuTarget & { x: number; y: number; opener: HTMLElement }
  >();
  // Open state of folders (`rootId:path`) and of whole roots (`root:rootId`).
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const filtered = useMemo(
    () =>
      roots.map((root) => {
        const files = root.files.filter((file) =>
          file.toLowerCase().includes(query.toLowerCase()),
        );
        return { ...root, files, nodes: tree(files) };
      }),
    [roots, query],
  );
  const toggle = (key: string, isOpen: boolean) =>
    setExpanded((previous) => ({ ...previous, [key]: !isOpen }));
  // Right-click, or Shift+F10 and the context menu key from the keyboard.
  const menuProps = (target: MenuTarget) => {
    const show = (
      event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
    ) => {
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect();
      setMenu({
        ...target,
        opener: event.currentTarget,
        x: "clientX" in event ? event.clientX : box.left + 24,
        y: "clientY" in event ? event.clientY : box.bottom,
      });
    };
    return {
      onContextMenu: show,
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        if (
          event.key === "ContextMenu" ||
          (event.shiftKey && event.key === "F10")
        )
          show(event);
      },
    };
  };
  const items = menu
    ? (
        [
          ["create", "New file here…", menu.folder],
          ["rename", "Rename…", !menu.folder],
          ["trash", "Move to Trash", !menu.folder],
          ["reveal", "Reveal in Finder", true],
          [
            "entry",
            "Set as entry file",
            !menu.folder &&
              menu.rootId === "primary" &&
              menu.path.endsWith(".tex") &&
              menu.path !== mainFile,
          ],
        ] as const
      ).filter((item) => item[2])
    : [];
  const closeMenu = () => {
    menu?.opener.focus();
    setMenu(undefined);
  };
  function render(nodes: FileNode[], rootId: string, depth = 0) {
    return nodes.map((node) => {
      const key = `${rootId}:${node.path}`;
      const isExpanded =
        !!query ||
        (expanded[key] ??
          (activeRoot === rootId && active.startsWith(node.path + "/")));
      return node.children ? (
        <div key={key}>
          <button
            className="file-tree-row directory"
            style={{ paddingLeft: 14 + depth * 12 }}
            onClick={() => toggle(key, isExpanded)}
            aria-expanded={isExpanded}
            {...menuProps({ rootId, path: node.path, folder: true })}
          >
            {isExpanded ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}{" "}
            {isExpanded ? <FolderOpen size={13} /> : <Folder size={13} />}{" "}
            <span>{node.name}</span>
          </button>
          {isExpanded && render(node.children, rootId, depth + 1)}
        </div>
      ) : (
        <button
          key={key}
          className={`file-tree-row ${activeRoot === rootId && active === node.path ? "selected" : ""}`}
          style={{ paddingLeft: 28 + depth * 12 }}
          onClick={() => open(node.path, rootId)}
          title={node.path}
          {...menuProps({ rootId, path: node.path, folder: false })}
        >
          {/\.(py|js|jsx|ts|tsx|rs|go|c|cpp|h|sh|sql)$/.test(node.name) ? (
            <FileCode2 size={13} />
          ) : (
            <FileText size={13} />
          )}{" "}
          <span>{node.name}</span>
          {rootId === "primary" && node.path === mainFile && (
            <small className="entry-badge">entry</small>
          )}
        </button>
      );
    });
  }
  return (
    <>
      {roots.length > 0 && (
        <SearchField
          label="Find project files"
          placeholder="Find a file…"
          value={query}
          onChange={setQuery}
        />
      )}
      <div className="file-list">
        {filtered.map((root) => {
          const rootOpen = expanded[`root:${root.id}`] ?? true;
          return (
            <section className="file-root" key={root.id}>
              <div className="file-root-heading">
                <button
                  onClick={() => toggle(`root:${root.id}`, rootOpen)}
                  aria-expanded={rootOpen}
                  title={root.folder}
                  {...menuProps({ rootId: root.id, path: "", folder: true })}
                >
                  {rootOpen ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                  <FolderOpen size={14} />
                  <strong>{root.label}</strong>
                  <small>{root.files.length}</small>
                </button>
                <button
                  className="icon-button"
                  title={`Show ${root.label} in Finder`}
                  onClick={() =>
                    void window.research?.revealFolder(projectId, root.id)
                  }
                >
                  <ExternalLink size={12} />
                </button>
                {root.id !== "primary" && (
                  <button
                    className="icon-button"
                    title={`Remove ${root.label} folder from project`}
                    onClick={() => remove(root.id)}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              {rootOpen &&
                (root.error ? (
                  <p className="file-empty">{root.error}</p>
                ) : root.files.length ? (
                  <>
                    {render(root.nodes, root.id)}
                    {root.truncated && !query && (
                      <p className="file-empty">
                        Some files are not listed. The tree shows up to 1,500
                        files, six folders deep.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="file-empty">
                    {query
                      ? "No matching files"
                      : "No editable files in this folder"}
                  </p>
                ))}
            </section>
          );
        })}
        {!roots.length && (
          <div className="file-empty">
            <FolderOpen size={24} />
            <p>Add your manuscript or a local project folder.</p>
          </div>
        )}
      </div>
      {menu && (
        // Focus leaving the menu closes it, so an outside click or Tab does too.
        <div
          className="file-menu"
          role="menu"
          aria-label="File actions"
          tabIndex={-1}
          style={{
            left: menu.x,
            // Rows in the lower half open the menu upward, so it stays on screen.
            ...(menu.y > innerHeight / 2
              ? { bottom: innerHeight - menu.y }
              : { top: menu.y }),
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              setMenu(undefined);
          }}
          onKeyDown={(event) => {
            const buttons = [...event.currentTarget.querySelectorAll("button")];
            const at = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next = (
              {
                ArrowDown: at + 1,
                ArrowUp: at - 1,
                Home: 0,
                End: -1,
              } as Record<string, number>
            )[event.key];
            if (event.key === "Escape") closeMenu();
            else if (next !== undefined) {
              event.preventDefault();
              buttons.at(next % buttons.length)?.focus();
            }
          }}
        >
          {items.map(([action, label], index) => (
            <button
              key={action}
              role="menuitem"
              autoFocus={index === 0}
              onClick={() => {
                closeMenu();
                act(action, menu.rootId, menu.path);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </>
  );
});
