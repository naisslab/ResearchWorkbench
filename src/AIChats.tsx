import { useEffect, useState } from "react";
import { History, Plus, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import type { AIChatAction, AIChatSummary, AIConversation } from "./types";
import { unwrap } from "./ai-result";
import Modal from "./Modal";

export default function AIChats({
  projectId,
  conversation,
  disabled,
  changed,
  report,
}: {
  projectId: string;
  conversation: AIConversation;
  disabled: boolean;
  changed(value: AIConversation): void;
  report(message: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [chats, setChats] = useState<AIChatSummary[]>([]);
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState("");
  async function refresh() {
    setChats(await unwrap(window.research!.aiChats(projectId)));
  }
  useEffect(() => {
    if (open) void refresh().catch((e) => report(e.message));
  }, [open, projectId, conversation.chatId]);
  useEffect(() => {
    setTitle(conversation.title || "");
  }, [conversation.chatId, conversation.title]);
  async function act(action: AIChatAction, id?: string) {
    if (busy || disabled) return;
    setBusy(true);
    try {
      changed(
        await unwrap(
          window.research!.aiManageChat(projectId, action, id, title),
        ),
      );
      await refresh();
      setDeleting("");
      if (action === "new" || action === "select") setOpen(false);
    } catch (e) {
      report((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const visibleChats = chats.filter(
    (c) =>
      c.archived === archived &&
      c.title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <button
        className="ai-toolbar-button"
        title="Conversation history"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <History size={14} /> Chats
      </button>
      <button
        className="icon-button"
        title="New AI chat"
        disabled={disabled || busy || !conversation.profileId}
        onClick={() => void act("new")}
      >
        <Plus size={14} />
      </button>
      {open && (
        <Modal title="Project conversations" onClose={() => setOpen(false)}>
          <p className="muted">
            Keep writing, experiments, and reviews in separate conversations.
            Archived chats keep their change backups; deleting a chat removes
            them.
          </p>
          <input
            aria-label="Search conversations"
            placeholder="Search conversation names…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label>
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />{" "}
            Show archived
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act("rename", conversation.chatId);
            }}
            className="chat-rename"
          >
            <input
              aria-label="Conversation name"
              maxLength={120}
              placeholder="Name the current conversation"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <button
              className="button"
              disabled={disabled || busy || !title.trim()}
            >
              Rename current
            </button>
          </form>
          <div className="chat-list">
            {visibleChats.map((c) => (
              <div className="chat-row" key={c.id}>
                <button
                  disabled={disabled || busy}
                  onClick={() => void act("select", c.id)}
                >
                  <strong>{c.title}</strong>
                  <small>
                    {c.active ? "Current · " : ""}
                    {c.updatedAt && new Date(c.updatedAt).toLocaleString()}
                  </small>
                </button>
                <button
                  className="icon-button"
                  disabled={disabled || busy}
                  title={
                    c.archived
                      ? "Unarchive conversation"
                      : "Archive conversation"
                  }
                  onClick={() =>
                    void act(c.archived ? "unarchive" : "archive", c.id)
                  }
                >
                  {c.archived ? (
                    <ArchiveRestore size={15} />
                  ) : (
                    <Archive size={15} />
                  )}
                </button>
                {!c.active &&
                  (deleting === c.id ? (
                    <span className="chat-delete-confirm">
                      <button
                        className="button danger"
                        disabled={disabled || busy}
                        onClick={() => void act("delete", c.id)}
                      >
                        Delete
                      </button>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => setDeleting("")}
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      className="icon-button"
                      disabled={disabled || busy}
                      title="Delete conversation and its change backups"
                      onClick={() => setDeleting(c.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  ))}
              </div>
            ))}
            {!visibleChats.length && (
              <p className="muted">No conversations match.</p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
