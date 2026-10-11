import Dictation from "./Dictation";
import { useDraft } from "./useDraft";
import AIChats from "./AIChats";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Sparkles,
  ArrowUp,
  Square,
  RefreshCw,
  ExternalLink,
  FileText,
  TextSelect,
  X,
  Plus,
  ChevronDown,
  ChevronRight,
  ArrowDown,
  LogOut,
  Gauge,
  Folder,
  Check,
  LoaderCircle,
  BookOpen,
  ListPlus,
  Pause,
  Play,
  ShieldCheck,
} from "lucide-react";
import type {
  AIApproval,
  AIContext,
  AIConversation,
  AIMessage,
  AIState,
  AISkill,
  AISkillCatalog,
  Project,
} from "./types";
import AIMarkdown, { CopyAction } from "./AIMarkdown";
import AIActivityLog from "./AIActivityLog";
import AIChangeReview from "./AIChangeReview";
import { unwrap } from "./ai-result";
import AISkills from "./AISkills";
import {
  findSkillCommand,
  skillSuggestions,
  type SkillCommand,
} from "./skillCommands";
import AIAgentControls, {
  effortLabel,
  useAIAgentSettings,
} from "./AIAgentControls";
import "./ai.css";

const number = (value: number) => value.toLocaleString("en-US");
const starterRequests = {
  "Fix LaTeX build":
    "Compile the LaTeX manuscript, fix any build errors, and tell me what changed.",
  "Run tests":
    "Inspect this project, identify the relevant tests, and run them. Fix failures related to the current changes.",
  "Improve the draft":
    "Review the manuscript for clarity and consistency. Propose and apply focused edits, then check that it still compiles.",
};

function Approval({
  request,
  busy,
  answer,
}: {
  request: AIApproval;
  busy: boolean;
  answer(
    decision: "accept" | "decline" | "answer",
    answers?: Record<string, { answers: string[] }>,
  ): void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const fileAccess = request.permissions?.fileSystem;
  const accessLabels = { read: "Read", write: "Write", deny: "Blocked" };
  const requestedFiles = [
    ...(fileAccess?.read || []).map((path) => `Read: ${path}`),
    ...(fileAccess?.write || []).map((path) => `Write: ${path}`),
    ...(fileAccess?.entries || []).map(({ access, path }) => {
      const target =
        path.type === "path"
          ? path.path
          : path.type === "glob_pattern"
            ? path.pattern
            : [
                path.value.path || path.value.kind.replaceAll("_", " "),
                path.value.subpath,
              ]
                .filter(Boolean)
                .join("/");
      return `${accessLabels[access]}: ${target}`;
    }),
  ];
  return (
    <div className="ai-approval">
      <strong>
        {request.kind === "question"
          ? "The agent needs your input"
          : request.kind === "file"
            ? "Approve file access"
            : request.kind === "permissions"
              ? "Additional access requested"
              : request.network
                ? "Approve network access"
                : "Approve command"}
      </strong>
      {request.reason && <p>{request.reason}</p>}
      {request.command && <pre>{request.command}</pre>}
      {request.cwd && <small>Working directory: {request.cwd}</small>}
      {request.grantRoot && (
        <small>Requested folder: {request.grantRoot}</small>
      )}
      {request.network && (
        <small>
          {request.network.protocol} · {request.network.host}
        </small>
      )}
      {request.permissions?.network?.enabled && (
        <small>
          Network access for this{" "}
          {request.kind === "permissions" ? "turn" : "command"}
        </small>
      )}
      {requestedFiles.length > 0 && <pre>{requestedFiles.join("\n")}</pre>}
      {request.kind === "question" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            answer(
              "answer",
              Object.fromEntries(
                (request.questions || []).map((q) => [
                  q.id,
                  { answers: [values[q.id] || ""] },
                ]),
              ),
            );
          }}
        >
          {request.questions?.map((question) => (
            <label key={question.id}>
              {question.question}
              {question.options && (
                <div className="ai-answer-options">
                  {question.options.map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      className={
                        values[question.id] === option.label ? "selected" : ""
                      }
                      title={option.description}
                      onClick={() =>
                        setValues((v) => ({
                          ...v,
                          [question.id]: option.label,
                        }))
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
              <input
                aria-label={question.question}
                value={values[question.id] || ""}
                onChange={(event) =>
                  setValues((v) => ({
                    ...v,
                    [question.id]: event.target.value,
                  }))
                }
                placeholder="Your answer"
                required
              />
            </label>
          ))}
          <button
            className="button primary small"
            disabled={busy}
            type="submit"
          >
            Continue
          </button>
        </form>
      ) : (
        <div className="ai-approval-actions">
          {request.canAccept !== false && (
            <button
              className="button primary small"
              disabled={busy}
              onClick={() => answer("accept")}
            >
              {request.kind === "permissions"
                ? "Allow for this turn"
                : "Allow once"}
            </button>
          )}
          <button
            className="button small"
            disabled={busy}
            onClick={() => answer("decline")}
          >
            Decline
          </button>
        </div>
      )}
    </div>
  );
}

const Message = memo(function Message({
  message,
  modelLabel,
  answering,
  answer,
  openReference,
  review,
}: {
  message: AIMessage;
  modelLabel?: string;
  answering: boolean;
  answer(
    request: AIApproval,
    decision: "accept" | "decline" | "answer",
    answers?: Record<string, { answers: string[] }>,
  ): void;
  openReference(reference: string, action?: "open" | "reveal"): void;
  review(messageId: string): void;
}) {
  const changedFiles = [
    ...new Set(
      message.activities?.flatMap(
        (activity) => activity.changes?.map((change) => change.path) || [],
      ) || [],
    ),
  ];
  return (
    <article
      className={`ai-message ai-message-${message.role}`}
      data-message-id={message.id}
    >
      <div className="ai-message-heading">
        {message.role === "assistant" ? (
          <Sparkles size={14} />
        ) : (
          <span className="ai-user-dot" />
        )}
        <strong>{message.role === "assistant" ? "Agent" : "You"}</strong>
        {message.model && <span>{modelLabel || message.model}</span>}
        {message.permissionNote && (
          <span title={message.permissionNote}>
            <ShieldCheck size={12} /> Default permissions
          </span>
        )}
        {message.status === "running" && (
          <span className="ai-run-state" role="status">
            <LoaderCircle size={12} className="spin" />
            {message.approvals?.length ? "Needs your approval" : "Working…"}
          </span>
        )}
      </div>
      {message.attachments?.map((attachment, index) => (
        <small className="ai-message-attachment" key={index}>
          <FileText size={11} /> {attachment.name}
          {attachment.kind === "selection" ? " · selection" : ""}
        </small>
      ))}
      {message.role === "user" && !!message.skills?.length && (
        <div className="ai-message-skills">
          {message.skills.map((skill) => (
            <small key={skill.name} title={`Used ${skill.name}`}>
              <BookOpen size={11} />
              {skill.displayName}
            </small>
          ))}
        </div>
      )}
      <AIActivityLog
        message={message}
        changedFileCount={changedFiles.length}
        openReference={openReference}
      />
      {message.approvals?.map((request) => (
        <Approval
          key={request.id}
          request={request}
          busy={answering}
          answer={(decision, answers) => answer(request, decision, answers)}
        />
      ))}
      {message.text &&
        (message.role === "assistant" ? (
          <AIMarkdown text={message.text} openReference={openReference} />
        ) : (
          <div className="ai-user-text">{message.text}</div>
        ))}
      {!!changedFiles.length && message.status !== "running" && (
        <div className="ai-changed-files">
          {changedFiles.map((path) => (
            <button
              type="button"
              key={path}
              title={`Open ${path}`}
              onClick={() => openReference(path)}
            >
              <FileText size={12} />
              <span>{path.split("/").at(-1)}</span>
            </button>
          ))}
        </div>
      )}
      {message.role === "assistant" &&
        message.status !== "running" &&
        (message.review || message.diff || changedFiles.length > 0) && (
          <button
            type="button"
            className="ai-review-button"
            onClick={() => review(message.id)}
          >
            <FileText size={13} />
            Review changes
            {message.review && !message.review.unavailable && (
              <span>
                {message.review.files}{" "}
                {message.review.files === 1 ? "file" : "files"}
              </span>
            )}
            {!!message.review?.revertedFiles && !message.review.revertedAt && (
              <span className="ai-reverted">
                {message.review.revertedFiles} files reverted
              </span>
            )}
            {message.review?.revertedAt ? (
              <span className="ai-reverted">
                <Check size={12} /> Reverted
              </span>
            ) : (
              <ChevronRight size={12} />
            )}
          </button>
        )}
      {message.error && (
        <p className="ai-message-error" role="alert">
          {message.error.message}
          {message.error.requestId && (
            <small>Request: {message.error.requestId}</small>
          )}
        </p>
      )}
      {message.text && message.status !== "running" && (
        <div className="ai-message-footer">
          <CopyAction text={message.text} />
          {message.usage && (
            <small
              className="ai-message-usage"
              title="Tokens reported for this run"
            >
              {number(message.usage.inputTokens)} input ·{" "}
              {number(message.usage.outputTokens)} output tokens
            </small>
          )}
          {message.status === "cancelled" && <small>Stopped</small>}
        </div>
      )}
    </article>
  );
});

export default memo(function AIPanel({
  project,
  file,
  rootId,
  hasText,
  hasSelection,
  readText,
  dirty,
  prepare,
  onRunning,
  onFilesChanged,
  onOpenReference,
  visible,
  request,
  searchTarget,
}: {
  searchTarget?: import("./types").SearchHit;
  /** A request to place in the composer for the user to send. */
  request?: { context?: AIContext; draft: string; nonce: number };
  project: Project;
  file: string;
  rootId: string;
  hasText: boolean;
  hasSelection: boolean;
  /** The editor's text now, read only when it is attached. */
  readText(kind: "file" | "selection"): string;
  dirty: boolean;
  prepare(): Promise<void>;
  onRunning(running: boolean): void;
  onFilesChanged(): Promise<void>;
  onOpenReference(
    reference: string,
    rootId: string,
    action?: "open" | "reveal",
  ): Promise<void>;
  visible: boolean;
}) {
  const [state, setState] = useState<AIState | null>(null);
  const [conversation, setConversation] = useState<AIConversation>({
    projectId: project.id,
    profileId: null,
    messages: [],
  });
  const [model, setModel] = useState("");
  const [agentRoot, setAgentRoot] = useState("primary");
  const [context, setContext] = useState<AIContext>();
  const [operation, setOperation] = useState("");
  const [reviewMessage, setReviewMessage] = useState<string>();
  const [error, setError] = useState("");
  const [popover, setPopover] = useState<"account" | "usage" | null>(null);
  const popoverOpener = useRef<HTMLButtonElement | null>(null);
  const popoverPanel = useRef<HTMLDivElement>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skillCatalog, setSkillCatalog] = useState<AISkillCatalog | null>(null);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<AISkill[]>([]);
  const [skillCommand, setSkillCommand] = useState<SkillCommand | null>(null);
  const [activeSkillId, setActiveSkillId] = useState<string>();
  const dismissedSkillCommand = useRef("");
  const composing = useRef(false);
  const suggestionsId = `ai-skill-suggestions-${useId()}`;
  const skillRequest = useRef(0);
  const [showLatest, setShowLatest] = useState(false);
  const stateRef = useRef<AIState | null>(null);
  const modelRefresh = useRef("");
  const [dictating, setDictating] = useState(false);
  const dictationRange = useRef({ start: 0, end: 0 });
  const transcript = useRef<HTMLDivElement>(null);
  const transcriptPosition = useRef(0);
  const transcriptContent = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const skillButton = useRef<HTMLButtonElement>(null);
  const stickToBottom = useRef(true);
  const wasRunning = useRef(false);
  const submitting = useRef(false);
  // Unknown while a signed-in chat loads; typing meanwhile stays in memory.
  // Signed out, there is no chat, and drafts use one key per project.
  const draftKey = conversation.chatId
    ? `research-workbench.ai-draft.${state?.activeProfileId}.${project.id}.${conversation.chatId}`
    : state && !state.activeProfileId
      ? `research-workbench.ai-draft.disconnected.${project.id}.legacy`
      : null;
  const [draft, saveDraft] = useDraft(
    draftKey,
    conversation.chatId === "legacy"
      ? `research-workbench.ai-draft.${state?.activeProfileId}.${project.id}`
      : undefined,
    // Context, skills and review belong to the chat being left.
    () => {
      setContext(undefined);
      setSelectedSkills([]);
      setReviewMessage(undefined);
    },
  );
  const running = conversation.messages.some(
    (message) => message.status === "running",
  );
  const queued = conversation.queue || [];
  const busy =
    running ||
    operation === "send" ||
    operation === "revert" ||
    (!!queued.length && !conversation.queuePaused);
  const profile = state?.profiles.find((p) => p.id === state.activeProfileId);
  const selectedModel = state?.models.find((m) => m.slug === model);
  const { settings: agentSettings, update: updateAgentSettings } =
    useAIAgentSettings(state?.activeProfileId, project.id, selectedModel);
  const roots = useMemo(
    () => [
      ...(project.folder
        ? [
            {
              id: "primary",
              label: project.folderLabel || "Manuscript",
              folder: project.folder,
            },
          ]
        : [{ id: "primary", label: "Project notes & to-dos", folder: "" }]),
      ...(project.localFolders || []),
    ],
    [project.folder, project.folderLabel, project.localFolders],
  );
  const root = roots.find((item) => item.id === agentRoot);

  const takeState = useCallback((next: AIState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const loadSkills = useCallback(
    async (forceReload = false) => {
      if (!window.research) return;
      const request = ++skillRequest.current;
      setSkillsLoading(true);
      setSkillsError("");
      try {
        const catalog = await unwrap(
          window.research.aiSkills(project.id, agentRoot, forceReload),
        );
        if (request === skillRequest.current) setSkillCatalog(catalog);
      } catch (error) {
        if (request === skillRequest.current)
          setSkillsError((error as Error).message);
      } finally {
        if (request === skillRequest.current) setSkillsLoading(false);
      }
    },
    [project.id, agentRoot],
  );
  useEffect(() => {
    setSkillCatalog(null);
    setSelectedSkills([]);
    setSkillsOpen(false);
    setSkillCommand(null);
    dismissedSkillCommand.current = "";
    setSkillsError("");
    return () => {
      skillRequest.current++;
    };
  }, [project.id, agentRoot]);
  useEffect(() => {
    if (visible && root && !skillCatalog && !skillsLoading && !skillsError)
      void loadSkills();
  }, [visible, root, skillCatalog, skillsLoading, skillsError, loadSkills]);
  useEffect(() => {
    if (!visible) {
      setSkillsOpen(false);
      setSkillCommand(null);
    }
  }, [visible]);
  const closeSkills = () => {
    setSkillsOpen(false);
    input.current?.focus();
  };
  useEffect(() => {
    const api = window.research;
    if (!api) {
      setError("AI is available in the desktop app.");
      return;
    }
    let disposed = false;
    let deltaTimer: ReturnType<typeof setTimeout> | undefined;
    const deltas = new Map<string, string>();
    const discardDeltas = () => {
      clearTimeout(deltaTimer);
      deltaTimer = undefined;
      deltas.clear();
    };
    const offState = api.onAIState((next) => {
      if (!disposed) takeState(next);
    });
    const offConversation = api.onAIConversation((next) => {
      if (
        !disposed &&
        next.projectId === project.id &&
        next.profileId === stateRef.current?.activeProfileId
      ) {
        // Conversation snapshots already contain every delta sent before them.
        discardDeltas();
        setConversation(next);
      }
    });
    const offMessage = api.onAIMessage((event) => {
      if (
        disposed ||
        event.projectId !== project.id ||
        event.profileId !== stateRef.current?.activeProfileId
      )
        return;
      // The message already contains its earlier deltas.
      deltas.delete(event.message.id);
      // Unchanged messages keep their identity, so they do not re-render.
      setConversation((value) => ({
        ...value,
        messages: value.messages.map((message) =>
          message.id === event.message.id ? event.message : message,
        ),
      }));
    });
    const offDelta = api.onAIDelta((event) => {
      if (
        !disposed &&
        event.projectId === project.id &&
        event.profileId === stateRef.current?.activeProfileId
      ) {
        deltas.set(
          event.requestId,
          (deltas.get(event.requestId) || "") + event.delta,
        );
        if (!deltaTimer)
          deltaTimer = setTimeout(() => {
            const pending = new Map(deltas);
            discardDeltas();
            if (!disposed)
              setConversation((value) => ({
                ...value,
                messages: value.messages.map((message) =>
                  pending.has(message.id)
                    ? {
                        ...message,
                        text: message.text + pending.get(message.id),
                      }
                    : message,
                ),
              }));
          }, 40);
      }
    });
    void unwrap(api.aiState())
      .then((next) => {
        if (!disposed) takeState(next);
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
      discardDeltas();
      offState();
      offConversation();
      offMessage();
      offDelta();
    };
  }, [project.id, takeState]);
  useEffect(() => {
    let disposed = false;
    setContext(undefined);
    setSkillCommand(null);
    dismissedSkillCommand.current = "";
    stickToBottom.current = true;
    setShowLatest(false);
    setError("");
    modelRefresh.current = "";
    setConversation({
      projectId: project.id,
      profileId: state?.activeProfileId || null,
      messages: [],
    });
    if (window.research)
      void unwrap(window.research.aiConversation(project.id))
        .then((next) => {
          if (!disposed) setConversation(next);
        })
        .catch((e) => {
          if (!disposed) setError(e.message);
        });
    return () => {
      disposed = true;
    };
  }, [project.id, state?.activeProfileId]);
  useEffect(() => {
    if (!request) return;
    if (request.context) setContext(request.context);
    if (!draft.trim()) updateDraft(request.draft);
    input.current?.focus();
  }, [request?.nonce]);
  useEffect(() => {
    if (
      searchTarget?.kind !== "chat" ||
      conversation.chatId !== searchTarget.chatId
    )
      return;
    const element = transcript.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(searchTarget.messageId || "")}"]`,
    );
    if (element) {
      stickToBottom.current = false;
      element.scrollIntoView({ block: "center" });
      element.animate(
        [{ backgroundColor: "#eabf3d66" }, { backgroundColor: "transparent" }],
        { duration: 2200 },
      );
    }
  }, [searchTarget?.id, conversation.chatId, conversation.messages.length]);
  function updateDraft(value: string) {
    saveDraft(value);
    setSkillCommand(null);
    dismissedSkillCommand.current = "";
  }
  useEffect(() => {
    if (!root && roots.length) setAgentRoot(roots[0].id);
  }, [root, roots]);
  useEffect(() => {
    if (conversation.agentRootId) setAgentRoot(conversation.agentRootId);
  }, [conversation.agentRootId]);
  useEffect(() => {
    if (
      !state?.sharing ||
      state.status !== "connected" ||
      state.models.length ||
      state.modelError ||
      !state.activeProfileId ||
      modelRefresh.current === state.activeProfileId
    )
      return;
    modelRefresh.current = state.activeProfileId;
    setOperation("models");
    void unwrap(window.research!.aiModels())
      .then(takeState)
      .catch((e) => setError(e.message))
      .finally(() => setOperation(""));
  }, [state, takeState]);
  useEffect(() => {
    if (!state?.activeProfileId) {
      setModel("");
      return;
    }
    let preferred = "";
    try {
      preferred =
        localStorage.getItem(
          `research-workbench.ai-model.${state.activeProfileId}`,
        ) || "";
    } catch {
      /* Use the catalog default. */
    }
    setModel((current) =>
      state.models.some((m) => m.slug === preferred)
        ? preferred
        : state.models.some((m) => m.slug === current)
          ? current
          : state.models[0]?.slug || "",
    );
  }, [state?.models, state?.activeProfileId]);
  useLayoutEffect(() => {
    const node = transcript.current;
    if (stickToBottom.current && node && visible)
      node.scrollTop = node.scrollHeight;
  }, [conversation, visible]);
  useLayoutEffect(() => {
    if (visible && transcript.current && !stickToBottom.current)
      transcript.current.scrollTop = transcriptPosition.current;
  }, [visible]);
  useLayoutEffect(() => {
    if (!input.current || !visible) return;
    input.current.style.height = "0px";
    input.current.style.height = `${Math.min(112, Math.max(24, input.current.scrollHeight))}px`;
  }, [draft, visible]);
  useEffect(() => {
    const node = transcript.current;
    const content = transcriptContent.current;
    if (!node || !content) return;
    const resize = new ResizeObserver(() => {
      if (!node.clientHeight) return;
      if (stickToBottom.current) node.scrollTop = node.scrollHeight;
      setShowLatest(
        node.scrollHeight - node.scrollTop - node.clientHeight > 48,
      );
    });
    resize.observe(node);
    resize.observe(content);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    let current = true;
    if (wasRunning.current && !busy)
      void onFilesChanged().finally(() => {
        if (current) onRunning(false);
      });
    else onRunning(busy);
    wasRunning.current = busy;
    return () => {
      current = false;
    };
  }, [busy, onFilesChanged, onRunning]);
  // Escape closes only an open menu and returns focus to its button.
  useEffect(() => {
    if (!visible || (!popover && !skillsOpen)) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (popover) {
        setPopover(null);
        popoverOpener.current?.focus();
      }
      setSkillsOpen(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [popover, skillsOpen, visible]);
  useEffect(() => {
    if (popover)
      popoverPanel.current
        ?.querySelector<HTMLElement>("button, a[href], input, select")
        ?.focus();
  }, [popover]);
  const togglePopover = (
    name: "account" | "usage",
    opener: HTMLButtonElement,
  ) => {
    popoverOpener.current = opener;
    setPopover((current) => (current === name ? null : name));
  };
  const perform = useCallback(
    async (name: string, fn: () => Promise<unknown>) => {
      setOperation(name);
      setError("");
      try {
        await fn();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setOperation("");
      }
    },
    [],
  );
  const openReference = useCallback(
    (reference: string, action: "open" | "reveal" = "open") => {
      setError("");
      const open = /^https?:/i.test(reference)
        ? window.research!.openLink(reference)
        : onOpenReference(
            reference,
            conversation.agentRootId || agentRoot,
            action,
          );
      void open.catch((error: Error) => setError(error.message));
    },
    [onOpenReference, conversation.agentRootId, agentRoot],
  );
  const answer = useCallback(
    (
      request: AIApproval,
      decision: "accept" | "decline" | "answer",
      answers?: Record<string, { answers: string[] }>,
    ) => {
      void perform("answer", () =>
        unwrap(
          window.research!.aiAnswer({
            projectId: project.id,
            id: request.id,
            decision,
            answers,
          }),
        ),
      );
    },
    [perform, project.id],
  );
  useEffect(() => {
    setReviewMessage(undefined);
  }, [state?.activeProfileId]);
  async function revert(messageId: string, fileIds?: string[]) {
    // Flush the editor first so the backend guard sees unsaved user changes.
    await prepare();
    setOperation("revert");
    try {
      setConversation(
        await unwrap(window.research!.aiRevert(project.id, messageId, fileIds)),
      );
    } finally {
      setOperation("");
    }
  }
  function accountAction(name: string, fn: () => Promise<unknown>) {
    setPopover(null);
    void perform(name, async () => {
      await fn();
      takeState(await unwrap(window.research!.aiState()));
    });
  }
  async function send() {
    if (dictating) return;
    if (
      !draft.trim() ||
      skillCommand ||
      submitting.current ||
      operation ||
      !model ||
      !state?.sharing ||
      !root ||
      !state.runtime.available
    )
      return;
    submitting.current = true;
    const message = draft;
    stickToBottom.current = true;
    try {
      await perform("send", async () => {
        if (!busy) await prepare();
        const next = await unwrap(
          window.research!.aiSend({
            projectId: project.id,
            message,
            model,
            ...agentSettings,
            rootId: agentRoot,
            context,
            skillIds: selectedSkills.map((skill) => skill.id),
          }),
        );
        setConversation(next);
        updateDraft("");
        setContext(undefined);
        setSelectedSkills([]);
        setSkillsOpen(false);
        input.current?.focus();
      });
    } finally {
      submitting.current = false;
    }
  }
  function manageQueue(
    action: "pause" | "resume" | "remove" | "move",
    id?: string,
    direction?: -1 | 1,
  ) {
    void perform("queue", async () => {
      // Resuming starts a run, so the editor is saved first, as for Send.
      if (action === "resume") await prepare();
      setConversation(
        await unwrap(
          window.research!.aiQueue({
            projectId: project.id,
            action,
            id,
            direction,
          }),
        ),
      );
    });
  }
  function attach(kind: "file" | "selection") {
    setContext({
      kind,
      file,
      rootId,
      text: readText(kind),
    });
  }
  const actionDisabled = !!operation || state?.status === "connecting";
  const suggestedSkills = skillCommand
    ? skillSuggestions(skillCatalog?.skills || [], skillCommand.query).filter(
        (skill) =>
          selectedSkills.length < 8 ||
          selectedSkills.some((item) => item.id === skill.id),
      )
    : [];
  const activeSkill =
    suggestedSkills.find((skill) => skill.id === activeSkillId) ||
    suggestedSkills[0];
  const commandKey = (command: SkillCommand) =>
    `${command.start}:${command.end}:${command.query}`;
  function inspectSkillCommand(node: HTMLTextAreaElement) {
    if (
      composing.current ||
      actionDisabled ||
      !root ||
      skillsOpen ||
      !visible ||
      node.selectionStart !== node.selectionEnd
    ) {
      setSkillCommand(null);
      return;
    }
    const command = findSkillCommand(node.value, node.selectionStart);
    if (command && dismissedSkillCommand.current === commandKey(command)) {
      setSkillCommand(null);
      return;
    }
    if (
      command?.start !== skillCommand?.start ||
      command?.query !== skillCommand?.query
    )
      setActiveSkillId(undefined);
    setSkillCommand(command);
    if (command) setPopover(null);
  }
  function closeSkillCommands() {
    if (skillCommand) dismissedSkillCommand.current = commandKey(skillCommand);
    setSkillCommand(null);
  }
  function chooseSkillCommand(skill: AISkill) {
    if (
      !skillCommand ||
      (selectedSkills.length >= 8 &&
        !selectedSkills.some((item) => item.id === skill.id))
    )
      return;
    const before = draft.slice(0, skillCommand.start);
    let after = draft.slice(skillCommand.end);
    if (before.endsWith(" ") && after.startsWith(" ")) after = after.slice(1);
    if (!selectedSkills.some((item) => item.id === skill.id))
      setSelectedSkills((selected) => [...selected, skill]);
    updateDraft(before + after);
    setSkillsOpen(false);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(before.length, before.length);
    });
  }
  const banner =
    error ||
    state?.error?.message ||
    state?.modelError?.message ||
    state?.runtime.error?.message;
  const usageError = [state?.error, state?.modelError].some(
    (e) => e?.status === 429 || e?.code.includes("usage_limit"),
  );
  return (
    <section className="ai-panel" aria-label="Project AI agent">
      <div className="ai-toolbar">
        <div className="ai-agent-label">
          <Sparkles size={13} />
          <strong>Agent</strong>
        </div>
        <button
          className="icon-button"
          title="Refresh AI models"
          disabled={actionDisabled || busy || !state?.sharing}
          onClick={() =>
            void perform("models", async () =>
              takeState(await unwrap(window.research!.aiModels())),
            )
          }
        >
          <RefreshCw
            size={12}
            className={operation === "models" ? "spin" : ""}
          />
        </button>
        <div className="ai-toolbar-spacer" />
        <button
          className={
            popover === "usage"
              ? "ai-toolbar-button selected"
              : "ai-toolbar-button"
          }
          aria-haspopup="dialog"
          aria-expanded={popover === "usage"}
          onClick={(event) => togglePopover("usage", event.currentTarget)}
        >
          <Gauge size={13} /> Usage
        </button>
        <button
          className="ai-toolbar-button ai-account-button"
          aria-haspopup="dialog"
          aria-expanded={popover === "account"}
          onClick={(event) => togglePopover("account", event.currentTarget)}
        >
          <i className={state?.sharing ? "live-dot" : "idle-dot"} />
          <span>{profile?.label || "ChatGPT"}</span>
          <ChevronDown size={11} />
        </button>
        <AIChats
          projectId={project.id}
          conversation={conversation}
          disabled={busy || actionDisabled}
          changed={setConversation}
          report={setError}
        />
      </div>
      {popover && (
        <>
          <button
            className="ai-popover-dismiss"
            aria-label="Close AI menu"
            onClick={() => setPopover(null)}
          />
          <div
            ref={popoverPanel}
            className={`ai-popover ai-popover-${popover}`}
            role="dialog"
            aria-label={
              popover === "usage" ? "ChatGPT usage" : "ChatGPT account"
            }
          >
            {popover === "usage" ? (
              <>
                <strong>ChatGPT plan usage</strong>
                <p>Review your subscription limits and credits in ChatGPT.</p>
                <button
                  className="button small full-width"
                  onClick={() =>
                    void perform("usage", () =>
                      unwrap(window.research!.aiOpenUsage()),
                    )
                  }
                >
                  <ExternalLink size={12} /> Open ChatGPT Usage
                </button>
                <div className="ai-local-usage">
                  <strong>Recorded in Workbench</strong>
                  <dl>
                    <div>
                      <dt>Agent runs</dt>
                      <dd>{number(state?.usage.requests || 0)}</dd>
                    </div>
                    <div>
                      <dt>Input tokens</dt>
                      <dd>{number(state?.usage.inputTokens || 0)}</dd>
                    </div>
                    <div>
                      <dt>Output tokens</dt>
                      <dd>{number(state?.usage.outputTokens || 0)}</dd>
                    </div>
                  </dl>
                  <small>
                    Reported tokens for this account on this Mac, across
                    projects. These totals do not show your remaining plan
                    allowance.
                    {state?.usage.unreportedRequests
                      ? ` ${state.usage.unreportedRequests} runs did not report usage.`
                      : ""}
                  </small>
                </div>
              </>
            ) : (
              <>
                <strong>ChatGPT connection</strong>
                {state?.profiles.map((p) => (
                  <button
                    className="ai-profile"
                    key={p.id}
                    disabled={busy || actionDisabled}
                    onClick={() =>
                      accountAction("account", () =>
                        unwrap(window.research!.aiSelectProfile(p.id)),
                      )
                    }
                  >
                    <span>
                      <b>{p.label}</b>
                      <small>
                        {p.sharing
                          ? "Using ChatGPT plan"
                          : p.status === "connected"
                            ? "Plan usage disabled"
                            : "Reconnect required"}
                      </small>
                    </span>
                    {p.id === state.activeProfileId && <Check size={13} />}
                  </button>
                ))}
                {profile && (
                  <button
                    className="ai-menu-action"
                    disabled={busy || actionDisabled}
                    onClick={() =>
                      accountAction("connect", () =>
                        unwrap(
                          window.research!.aiSignIn({
                            profileId: profile.id,
                            reconsent: !state?.sharing,
                          }),
                        ),
                      )
                    }
                  >
                    <RefreshCw size={12} />
                    {state?.sharing
                      ? "Reconnect account"
                      : "Enable ChatGPT plan usage"}
                  </button>
                )}
                <button
                  className="ai-menu-action"
                  disabled={busy || actionDisabled}
                  onClick={() =>
                    accountAction("connect", () =>
                      unwrap(window.research!.aiSignIn({ newProfile: true })),
                    )
                  }
                >
                  <Plus size={12} /> Add ChatGPT account
                </button>
                {state?.sharing && (
                  <button
                    className="ai-menu-action"
                    disabled={busy || actionDisabled}
                    onClick={() =>
                      accountAction("disconnect", () =>
                        unwrap(window.research!.aiDisconnect()),
                      )
                    }
                  >
                    <LogOut size={12} /> Sign out
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
      {banner && (
        <div className="ai-error" role="alert">
          <span>{banner}</span>
          {usageError && (
            <button
              title="Open ChatGPT Usage"
              onClick={() =>
                void unwrap(window.research!.aiOpenUsage()).catch(() => {})
              }
            >
              <ExternalLink size={12} /> Usage
            </button>
          )}
        </div>
      )}
      {state?.status === "connecting" &&
        (state.sharing || !!conversation.messages.length) && (
          <div className="ai-error">
            <span>Finish ChatGPT sign-in in your browser.</span>
            <button
              onClick={() =>
                accountAction("cancel", () =>
                  unwrap(window.research!.aiCancelSignIn()),
                )
              }
            >
              Cancel
            </button>
          </div>
        )}
      <div className="ai-conversation-area">
        <div
          className="ai-transcript"
          ref={transcript}
          onClickCapture={(event) => {
            if ((event.target as HTMLElement).closest("summary"))
              stickToBottom.current = false;
          }}
          onScroll={() => {
            const node = transcript.current!;
            if (!visible || !node.clientHeight) return;
            transcriptPosition.current = node.scrollTop;
            const away =
              node.scrollHeight - node.scrollTop - node.clientHeight > 48;
            stickToBottom.current = !away;
            setShowLatest(away);
          }}
        >
          <div className="ai-transcript-content" ref={transcriptContent}>
            {!state ? (
              <div className="ai-empty">
                <LoaderCircle size={20} className="spin" />
                <p>Loading AI connection…</p>
              </div>
            ) : !state.sharing && !conversation.messages.length ? (
              <div className="ai-empty ai-connect">
                <div className="ai-empty-mark">
                  <Sparkles size={20} />
                </div>
                <div>
                  <h3>Your research, with an agent</h3>
                  <p>
                    Revise manuscripts, record writing tasks, and fix LaTeX
                    builds using your ChatGPT plan.
                  </p>
                </div>
                {state.status === "connecting" ? (
                  <div className="ai-connect-actions">
                    <span>
                      <LoaderCircle size={13} className="spin" /> Finish sign-in
                      in your browser
                    </span>
                    <button
                      className="button small"
                      onClick={() =>
                        accountAction("cancel", () =>
                          unwrap(window.research!.aiCancelSignIn()),
                        )
                      }
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="button primary small"
                    disabled={actionDisabled}
                    onClick={() =>
                      accountAction("connect", () =>
                        unwrap(
                          window.research!.aiSignIn({ reconsent: !!profile }),
                        ),
                      )
                    }
                  >
                    Continue with ChatGPT <ExternalLink size={12} />
                  </button>
                )}
              </div>
            ) : conversation.messages.length ? (
              conversation.messages.map((message) => (
                <Message
                  key={message.id}
                  message={message}
                  modelLabel={
                    state.models.find((model) => model.slug === message.model)
                      ?.displayName
                  }
                  answering={operation === "answer"}
                  answer={answer}
                  openReference={openReference}
                  review={setReviewMessage}
                />
              ))
            ) : (
              <div className="ai-empty ai-ready">
                <Sparkles size={18} />
                <div>
                  <h3>What should we work on?</h3>
                  <p>
                    The agent can edit files and run commands in your attached
                    project folders.
                  </p>
                  <div className="ai-starters">
                    {Object.entries(starterRequests).map(([label, request]) => (
                      <button key={label} onClick={() => updateDraft(request)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        {showLatest && (
          <button
            className="ai-jump-latest"
            type="button"
            onClick={() => {
              stickToBottom.current = true;
              if (transcript.current)
                transcript.current.scrollTop = transcript.current.scrollHeight;
              setShowLatest(false);
            }}
          >
            <ArrowDown size={13} /> Jump to latest
          </button>
        )}
      </div>
      <form
        className="ai-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div className="ai-composer-inner">
          {!!queued.length && (
            <section className="ai-request-queue" aria-label="Queued requests">
              <div className="ai-queue-heading">
                <ListPlus size={13} />
                <strong>{queued.length} queued</strong>
                <span role="status">
                  {conversation.queuePaused
                    ? "Paused"
                    : "Runs after the current request"}
                </span>
                <button
                  type="button"
                  disabled={actionDisabled}
                  onClick={() =>
                    manageQueue(conversation.queuePaused ? "resume" : "pause")
                  }
                  aria-label={
                    conversation.queuePaused
                      ? "Resume queued requests"
                      : "Pause queued requests"
                  }
                >
                  {conversation.queuePaused ? (
                    <Play size={12} />
                  ) : (
                    <Pause size={12} />
                  )}
                  {conversation.queuePaused ? "Resume" : "Pause"}
                </button>
              </div>
              {conversation.queueError && (
                <p role="alert" className="ai-queue-error">
                  {conversation.queueError.message}
                </p>
              )}
              <ol>
                {queued.map((item, index) => (
                  <li key={item.id}>
                    <span className="ai-queue-number">{index + 1}</span>
                    <div className="ai-queue-request" title={item.text}>
                      <p>{item.text}</p>
                      <small>
                        {state?.models.find((m) => m.slug === item.model)
                          ?.displayName || item.model}
                        {item.reasoningEffort
                          ? ` · ${effortLabel(item.reasoningEffort)}`
                          : ""}
                        {item.attachments?.length ? " · attachment" : ""}
                        {item.skills?.length
                          ? ` · ${item.skills.map((s) => s.displayName).join(", ")}`
                          : ""}
                      </small>
                    </div>
                    <button
                      type="button"
                      disabled={actionDisabled || index === 0}
                      aria-label={`Move queued request ${index + 1} up`}
                      onClick={() => manageQueue("move", item.id, -1)}
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      type="button"
                      disabled={actionDisabled || index === queued.length - 1}
                      aria-label={`Move queued request ${index + 1} down`}
                      onClick={() => manageQueue("move", item.id, 1)}
                    >
                      <ArrowDown size={12} />
                    </button>
                    <button
                      type="button"
                      disabled={actionDisabled}
                      aria-label={`Remove queued request ${index + 1}`}
                      onClick={() => manageQueue("remove", item.id)}
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <div className="ai-context-bar">
            <Folder size={11} />
            <select
              aria-label="Agent working folder"
              value={agentRoot}
              disabled={
                busy || !!conversation.messages.length || !!queued.length
              }
              title={root?.folder}
              onChange={(event) => setAgentRoot(event.target.value)}
            >
              {!roots.length && (
                <option value="primary">Attach a project folder</option>
              )}
              {roots.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              title="Attach a snapshot of the current file"
              disabled={actionDisabled || !file || !hasText}
              onClick={() => attach("file")}
            >
              <FileText size={11} /> Current file
            </button>
            <button
              type="button"
              title="Attach selected text from the editor"
              disabled={actionDisabled || !file || !hasSelection}
              onClick={() => attach("selection")}
            >
              <TextSelect size={11} /> Selection
            </button>
            {context && (
              <span className="ai-context-chip" title="Attached text snapshot">
                <FileText size={10} />
                {context.file.split("/").at(-1)}
                {context.kind === "selection" ? " · selection" : ""}
                <button
                  type="button"
                  aria-label="Remove AI attachment"
                  onClick={() => setContext(undefined)}
                >
                  <X size={10} />
                </button>
              </span>
            )}
            <div className="ai-skills-anchor">
              <button
                type="button"
                ref={skillButton}
                title="Choose skills, or type / in your message"
                aria-label="Choose skills"
                aria-expanded={skillsOpen}
                disabled={actionDisabled || !root}
                onClick={() => {
                  closeSkillCommands();
                  setSkillsOpen((open) => !open);
                  setPopover(null);
                }}
              >
                <BookOpen size={11} /> Skills
                {selectedSkills.length ? ` (${selectedSkills.length})` : ""}
              </button>
              {skillsOpen && (
                <AISkills
                  anchor={skillButton.current}
                  catalog={skillCatalog}
                  loading={skillsLoading}
                  error={skillsError}
                  selected={selectedSkills}
                  select={(skill) =>
                    setSelectedSkills((selected) =>
                      selected.some((item) => item.id === skill.id)
                        ? selected.filter((item) => item.id !== skill.id)
                        : [...selected, skill],
                    )
                  }
                  refresh={() => void loadSkills(true)}
                  close={closeSkills}
                />
              )}
            </div>
            <small>
              {busy
                ? "Agent working…"
                : dirty
                  ? "Current file will be saved before running"
                  : state?.sharing
                    ? "Using ChatGPT plan"
                    : "Connect ChatGPT to start"}
            </small>
          </div>
          {!!selectedSkills.length && (
            <div
              className="ai-selected-skills"
              aria-label="Skills for next message"
            >
              {selectedSkills.map((skill) => (
                <span
                  className="ai-context-chip"
                  key={skill.id}
                  title={skill.description}
                >
                  <BookOpen size={11} />
                  {skill.displayName}
                  <button
                    type="button"
                    disabled={actionDisabled}
                    aria-label={`Remove ${skill.name}`}
                    onClick={() =>
                      setSelectedSkills((selected) =>
                        selected.filter((item) => item.id !== skill.id),
                      )
                    }
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="ai-input-row">
            {skillCommand && (
              <AISkills
                anchor={input.current}
                catalog={skillCatalog}
                suggestions={{
                  id: suggestionsId,
                  skills: suggestedSkills,
                  query: skillCommand.query,
                  activeId: activeSkill?.id,
                  highlight: setActiveSkillId,
                }}
                selected={selectedSkills}
                loading={skillsLoading}
                error={skillsError}
                select={chooseSkillCommand}
                refresh={() => void loadSkills(true)}
                close={closeSkillCommands}
              />
            )}
            <textarea
              ref={input}
              aria-label="Message the AI agent"
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-expanded={!!skillCommand}
              aria-controls={skillCommand ? suggestionsId : undefined}
              aria-activedescendant={
                skillCommand && activeSkill
                  ? `${suggestionsId}-${activeSkill.id}`
                  : undefined
              }
              value={draft}
              readOnly={operation === "send" || dictating}
              placeholder={
                busy
                  ? "Send another request to add it to the queue…"
                  : state?.sharing
                    ? "Ask for a revision, add a to-do, or save a research note…"
                    : "Connect ChatGPT, then tell the agent what to work on…"
              }
              rows={1}
              onChange={(event) => {
                updateDraft(event.target.value);
                inspectSkillCommand(event.currentTarget);
              }}
              onSelect={(event) => inspectSkillCommand(event.currentTarget)}
              onFocus={(event) => inspectSkillCommand(event.currentTarget)}
              onBlur={(event) => {
                if (
                  !(event.relatedTarget instanceof Element) ||
                  !event.relatedTarget.closest(".ai-skill-suggestions")
                )
                  closeSkillCommands();
              }}
              onCompositionStart={() => {
                composing.current = true;
                setSkillCommand(null);
              }}
              onCompositionEnd={(event) => {
                composing.current = false;
                inspectSkillCommand(event.currentTarget);
              }}
              onKeyDown={(event) => {
                if (
                  composing.current ||
                  event.nativeEvent.isComposing ||
                  event.nativeEvent.keyCode === 229
                )
                  return;
                if (skillCommand) {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    closeSkillCommands();
                    return;
                  }
                  if (
                    (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                    suggestedSkills.length
                  ) {
                    event.preventDefault();
                    const index = suggestedSkills.findIndex(
                      (skill) => skill.id === activeSkill?.id,
                    );
                    setActiveSkillId(
                      suggestedSkills[
                        (index +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          suggestedSkills.length) %
                          suggestedSkills.length
                      ].id,
                    );
                    return;
                  }
                  if (
                    (event.key === "Enter" && !event.shiftKey) ||
                    (event.key === "Tab" && !event.shiftKey && activeSkill)
                  ) {
                    event.preventDefault();
                    if (activeSkill) chooseSkillCommand(activeSkill);
                    return;
                  }
                  if (event.key === "Tab") closeSkillCommands();
                }
                if (event.key === "$" && !draft && !actionDisabled && root) {
                  event.preventDefault();
                  setSkillsOpen(true);
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <AIAgentControls
              key={`${state?.activeProfileId}.${project.id}`}
              models={state?.models || []}
              model={selectedModel}
              settings={agentSettings}
              update={updateAgentSettings}
              disabled={actionDisabled || !state?.sharing || !visible}
              selectModel={(slug) => {
                setModel(slug);
                try {
                  localStorage.setItem(
                    `research-workbench.ai-model.${state?.activeProfileId}`,
                    slug,
                  );
                } catch {
                  /* Selection remains available this session. */
                }
              }}
            />
            <div className="ai-send-actions">
              {busy && (
                <button
                  className="ai-send ai-stop"
                  type="button"
                  title="Stop agent"
                  aria-label="Stop AI agent"
                  disabled={actionDisabled}
                  onClick={() =>
                    void perform("stop", async () =>
                      setConversation(
                        await unwrap(window.research!.aiStop(project.id)),
                      ),
                    )
                  }
                >
                  <Square size={13} fill="currentColor" />
                </button>
              )}
              <Dictation
                key={`${project.id}.${state?.activeProfileId}.${conversation.chatId || "legacy"}`}
                disabled={operation === "send" || !visible}
                onActive={(active) => {
                  setDictating(active);
                  if (active)
                    dictationRange.current = {
                      start: input.current?.selectionStart ?? draft.length,
                      end: input.current?.selectionEnd ?? draft.length,
                    };
                }}
                insert={(text) => {
                  const { start, end } = dictationRange.current;
                  updateDraft(draft.slice(0, start) + text + draft.slice(end));
                  requestAnimationFrame(() => {
                    input.current?.focus();
                    input.current?.setSelectionRange(
                      start + text.length,
                      start + text.length,
                    );
                  });
                }}
              />
              <button
                className="ai-send"
                type="submit"
                title={
                  busy || queued.length
                    ? "Queue message (Enter)"
                    : "Send message (Enter)"
                }
                aria-label={
                  busy || queued.length ? "Queue message" : "Run AI agent"
                }
                disabled={
                  dictating ||
                  !draft.trim() ||
                  !!skillCommand ||
                  !model ||
                  !state?.sharing ||
                  !root ||
                  actionDisabled ||
                  !state.runtime.available
                }
              >
                {busy || queued.length ? (
                  <ListPlus size={16} />
                ) : (
                  <ArrowUp size={20} />
                )}
              </button>
            </div>
          </div>
          <div className="ai-composer-hint">
            <span>
              {busy || queued.length
                ? "Enter to queue · / for skills · Shift+Enter for a new line"
                : "Enter to send · / for skills · Shift+Enter for a new line"}
            </span>
          </div>
        </div>
      </form>
      {reviewMessage && (
        <AIChangeReview
          key={reviewMessage}
          projectId={project.id}
          messageId={reviewMessage}
          agentBusy={running || (!!queued.length && !conversation.queuePaused)}
          onClose={() => setReviewMessage(undefined)}
          onRevert={revert}
          prepare={prepare}
          changed={onFilesChanged}
          openReference={(reference) => {
            setReviewMessage(undefined);
            openReference(reference);
          }}
        />
      )}
    </section>
  );
});
