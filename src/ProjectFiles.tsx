import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Search,
  X,
} from "lucide-react";
import type { ProjectFileRoot } from "./types";
interface FileNode {
  name: string;
  path: string;
  children?: Map<string, FileNode>;
}
function tree(files: string[]) {
  const nodes = new Map<string, FileNode>();
  for (const file of files) {
    let children = nodes;
    const parts = file.split("/");
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join("/");
      let node = children.get(name);
      if (!node) {
        node = {
          name,
          path,
          ...(index < parts.length - 1 ? { children: new Map() } : {}),
        };
        children.set(name, node);
      }
      if (node.children) children = node.children;
    });
  }
  return nodes;
}
export default function ProjectFiles({
  projectId,
  roots,
  active,
  activeRoot,
  mainFile,
  open,
  attach,
  change,
  remove,
}: {
  projectId: string;
  roots: ProjectFileRoot[];
  active: string;
  activeRoot: string;
  mainFile: string;
  open(file: string, rootId: string): void;
  attach(): void;
  change(): void;
  remove(rootId: string): void;
}) {
  const [query, setQuery] = useState("");
  const [closedRoots, setClosedRoots] = useState(new Set<string>());
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const filtered = useMemo(
    () =>
      roots.map((root) => ({
        ...root,
        files: root.files.filter((file) =>
          file.toLowerCase().includes(query.toLowerCase()),
        ),
      })),
    [roots, query],
  );
  function render(nodes: Map<string, FileNode>, rootId: string, depth = 0) {
    return [...nodes.values()]
      .sort(
        (a, b) =>
          Number(!!b.children) - Number(!!a.children) ||
          a.name.localeCompare(b.name),
      )
      .map((node) => {
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
              onClick={() =>
                setExpanded((previous) => ({ ...previous, [key]: !isExpanded }))
              }
              aria-expanded={isExpanded}
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
        <label className="file-search">
          <Search size={13} />
          <input
            aria-label="Find project files"
            placeholder="Find a file…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button title="Clear file search" onClick={() => setQuery("")}>
              <X size={12} />
            </button>
          )}
        </label>
      )}
      <div className="file-list">
        {filtered.map((root) => (
          <section className="file-root" key={root.id}>
            <div className="file-root-heading">
              <button
                onClick={() =>
                  setClosedRoots((previous) => {
                    const next = new Set(previous);
                    if (next.has(root.id)) next.delete(root.id);
                    else next.add(root.id);
                    return next;
                  })
                }
                aria-expanded={!closedRoots.has(root.id)}
                title={root.folder}
              >
                {closedRoots.has(root.id) ? (
                  <ChevronRight size={12} />
                ) : (
                  <ChevronDown size={12} />
                )}
                <FolderOpen size={14} />
                <strong>{root.label}</strong>
                <small>{root.files.length}</small>
              </button>
              {root.id !== "primary" && (
                <button
                  className="icon-button detach-file-root"
                  title={`Remove ${root.label} folder from project`}
                  onClick={() => remove(root.id)}
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {!closedRoots.has(root.id) && (
              <>
                <div className="file-root-location" title={root.folder}>
                  {root.folder.split("/").pop()}
                  <button
                    title={`Show ${root.label} in Finder`}
                    onClick={() =>
                      void window.research?.revealFolder(projectId, root.id)
                    }
                  >
                    ↗
                  </button>
                </div>
                {root.error ? (
                  <p className="file-empty">{root.error}</p>
                ) : root.files.length ? (
                  render(tree(root.files), root.id)
                ) : (
                  <p className="file-empty">
                    {query
                      ? "No matching files"
                      : "No editable files in this folder"}
                  </p>
                )}
              </>
            )}
          </section>
        ))}
        {!roots.length && (
          <div className="file-empty">
            <FolderOpen size={24} />
            <p>Add your manuscript or a local project folder.</p>
          </div>
        )}
      </div>
      <div className="file-sidebar-bottom">
        <button className="add-local-folder" onClick={attach}>
          <FolderPlus size={14} /> Add local folder
        </button>
        <button onClick={change}>
          {roots.length ? "Change project folder…" : "Choose project folder…"}
        </button>
      </div>
    </>
  );
}
