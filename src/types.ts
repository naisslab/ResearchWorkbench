import type { PdfReport } from "./submission.ts";
export type Stage =
  | "exploration"
  | "experiments"
  | "writing"
  | "submitted"
  | "revision"
  | "accepted"
  | "published";
export type DeadlineKind =
  | "abstract"
  | "submission"
  | "notification"
  | "revision"
  | "camera-ready"
  | "other";
export interface Area {
  id: string;
  name: string;
  color: string;
  icon: string;
}
export interface Task {
  id: string;
  text: string;
  done: boolean;
  pinned?: boolean;
  blocked?: string;
}
export interface Deadline {
  id: string;
  label: string;
  date: string;
  kind: DeadlineKind;
  url?: string;
}
export type Appearance = "light" | "dark" | "system";
export type DateCategory = "paper" | "funding" | "award" | "service" | "other";
export interface TrackedDeadline {
  id: string;
  label: string;
  subtitle: string;
  category: DateCategory;
  kind: DeadlineKind;
  time: string;
  timezone: string;
  originalDate?: string;
  status: "notStarted" | "ongoing" | "finished";
  notes?: string;
  url?: string;
  source: "manual" | "ccfddl" | "official";
  sourceKey?: string;
  sourceUrl?: string;
  conference?: string;
  eventId?: string;
  round?: number;
  importedFrom?: string;
  projectId?: string;
  projectIds?: string[];
}
export interface ConferenceFeed {
  conferences: {
    id: string;
    title: string;
    description: string;
    area: string;
    rank: string;
    events: {
      id: string;
      year: number;
      name: string;
      timezone: string;
      place: string;
      date: string;
      url?: string;
      dates: TrackedDeadline[];
    }[];
  }[];
  checkedAt?: string | null;
  lastSuccessAt?: string | null;
  error?: string | null;
  sourceUrl: string;
}
export interface DeadlineUpdate {
  id: string;
  label: string;
  previousTime: string;
  time: string;
  latest: TrackedDeadline;
}
export interface DeadlineFeedResult {
  feed: ConferenceFeed;
  updates: DeadlineUpdate[];
}
export interface LocalFolder {
  id: string;
  label: string;
  folder: string;
}
export interface ProjectFileRoot extends LocalFolder {
  files: string[];
  editableFiles: string[];
  /** The folder holds more files than the tree lists. */
  truncated?: boolean;
  error?: string;
}
export interface GitStatus {
  connected: boolean;
  repository?: string;
  branch: string;
  remote: string;
  remoteName?: string;
  remoteBranch?: string;
  hasRemoteBranch?: boolean;
  detached?: boolean;
  history?: { hash: string; subject: string; author: string; date: string }[];
  changes: { status: string; file: string }[];
  ahead: number;
  behind: number;
}
export interface GitDiff {
  file: string;
  text: string;
  truncated: boolean;
}
export interface Project {
  id: string;
  areaId: string;
  name: string;
  summary: string;
  stage: Stage;
  folder: string;
  mainFile: string;
  sshHost: string;
  venue: string;
  notes: string;
  tasks: Task[];
  deadlines: Deadline[];
  updatedAt: string;
  catalogId?: string;
  topic?: string;
  icon?: string;
  sourceNote?: string;
  folderLabel?: string;
  localFolders?: LocalFolder[];
  links?: { label: string; url: string }[];
  compileOnSave?: boolean;
  /** Unset reads `% !TEX program` from the entry file, then uses pdfLaTeX. */
  latexEngine?: "pdflatex" | "xelatex" | "lualatex";
  /** Pages allowed before the references, checked after each compile. */
  pageLimit?: number;
  /** Double-blind review: the check looks for anything naming the authors. */
  anonymousReview?: boolean;
}
export interface ResearchCandidate {
  id: string;
  project: Project;
  evidence: string[];
  confidence: "verified" | "inferred" | "review";
  collection: "current" | "archive";
  recommended: boolean;
  statusNote: string;
}
export interface ResearchCatalog {
  checkedAt: string;
  areas: Area[];
  candidates: ResearchCandidate[];
}
export interface Workspace {
  version: 1;
  appearance?: Appearance;
  /** System notifications a week and a day before each date; on unless false. */
  deadlineReminders?: boolean;
  trackedDeadlines: TrackedDeadline[];
  areas: Area[];
  projects: Project[];
}
export interface SearchHit {
  id: string;
  kind: "project" | "file" | "pdf" | "annotation" | "chat";
  projectId: string;
  projectName: string;
  title: string;
  snippet: string;
  file?: string;
  rootId?: string;
  line?: number;
  documentKey?: string;
  page?: number;
  x?: number;
  y?: number;
  version?: string;
  query?: string;
  chatId?: string;
  messageId?: string;
}
export interface SearchPacket {
  id?: string;
  results: SearchHit[];
  warnings: string[];
  scanned: number;
  cancelled?: boolean;
}
export interface BackupStatus {
  path: string;
  createdAt: string;
  bytes: number;
  files: number;
  skipped: string[];
}
export interface ReferenceCandidate {
  kind: "doi" | "arxiv";
  id: string;
  title: string;
  authors: string[];
  year: string;
  venue: string;
}
export interface DictationEvent {
  id: string;
  type: "listening" | "partial" | "final" | "error" | "cancelled";
  text?: string;
  message?: string;
}
export interface ResearchAPI {
  aiPaper(
    projectId: string,
    messageId: string,
  ): Promise<AIResult<AIPaperReview>>;
  aiPaperBuild(
    projectId: string,
    messageId: string,
  ): Promise<AIResult<AIPaperReview>>;
  readDraft(
    id: string,
    file: string,
    rootId: string,
  ): Promise<{ text: string; base: string; updatedAt: string } | null>;
  writeDraft(
    id: string,
    file: string,
    rootId: string,
    draft: { text: string; base: string } | null,
  ): Promise<void>;
  onWritingCapture(
    callback: (request: {
      id: string;
      projectId: string;
      capture: import("./writing-capture").WritingCapture;
    }) => void,
  ): () => void;
  completeWritingCapture(
    id: string,
    result: { saved: boolean },
  ): Promise<boolean>;
  startDictation(id: string, language: string): Promise<{ id: string }>;
  stopDictation(id: string): Promise<void>;
  cancelDictation(id: string): Promise<void>;
  onDictation(callback: (event: DictationEvent) => void): () => void;
  cancelBackup(): Promise<void>;
  onBackupProgress(
    callback: (value: {
      files: number;
      bytes: number;
      current: string;
    }) => void,
  ): () => void;
  backupStatus(): Promise<BackupStatus | null>;
  createBackup(options: {
    includeProjects: boolean;
    ui: Record<string, string>;
  }): Promise<BackupStatus | null>;
  restoreBackup(bindCurrentAccount: boolean): Promise<{
    workspace: Workspace;
    ui: Record<string, string>;
    rollback: string;
    restored: string;
    warnings: string[];
  } | null>;
  restartRestored(): Promise<void>;

  /** A command chosen in the application menu, by command id. */
  onMenuCommand(callback: (id: string) => void): () => void;
  lookupReference(
    input: string,
  ): Promise<{ bibtex?: string; candidates?: ReferenceCandidate[] }>;
  referenceBibtex(kind: "doi" | "arxiv", id: string): Promise<string>;
  pdfReport(
    projectId: string,
    references: { file: string; line: number } | null,
  ): Promise<PdfReport | null>;
  search(query: string, id: string): Promise<SearchPacket>;
  cancelSearch(): Promise<void>;
  onSearchProgress(callback: (packet: SearchPacket) => void): () => void;
  openSearchPdf(hit: SearchHit): Promise<{ url: string; name: string }>;

  aiState(): Promise<AIResult<AIState>>;
  aiSignIn(options?: {
    profileId?: string;
    newProfile?: boolean;
    reconsent?: boolean;
  }): Promise<AIResult<AISession>>;
  aiCancelSignIn(): Promise<AIResult<AISession>>;
  aiSelectProfile(id: string): Promise<AIResult<AISession>>;
  aiDisconnect(): Promise<AIResult<AISession>>;
  aiModels(): Promise<AIResult<AIState>>;
  aiSkills(
    projectId: string,
    rootId: string,
    forceReload?: boolean,
  ): Promise<AIResult<AISkillCatalog>>;
  aiChats(projectId: string): Promise<AIResult<AIChatSummary[]>>;
  aiManageChat(
    projectId: string,
    action: AIChatAction,
    chatId?: string,
    title?: string,
  ): Promise<AIResult<AIConversation>>;
  aiConversation(projectId: string): Promise<AIResult<AIConversation>>;
  aiReview(
    projectId: string,
    messageId: string,
  ): Promise<AIResult<AIChangeReview>>;
  aiReviewFile(
    projectId: string,
    messageId: string,
    fileId: string,
  ): Promise<AIResult<AIReviewedFile>>;
  aiRevert(
    projectId: string,
    messageId: string,
    fileIds?: string[],
  ): Promise<AIResult<AIConversation>>;
  aiSend(request: {
    projectId: string;
    message: string;
    model: string;
    permissionMode?: AIPermissionMode;
    reasoningEffort?: string;
    serviceTier?: string;
    rootId: string;
    context?: AIContext;
    skillIds?: string[];
  }): Promise<AIResult<AIConversation>>;
  aiQueue(request: {
    projectId: string;
    action: "pause" | "resume" | "remove" | "move";
    id?: string;
    direction?: -1 | 1;
  }): Promise<AIResult<AIConversation>>;
  aiAnswer(request: {
    projectId: string;
    id: string;
    decision: "accept" | "decline" | "cancel" | "answer";
    answers?: Record<string, { answers: string[] }>;
  }): Promise<AIResult<void>>;
  aiStop(projectId: string): Promise<AIResult<AIConversation>>;
  aiClear(projectId: string): Promise<AIResult<AIConversation>>;
  aiOpenUsage(): Promise<AIResult<void>>;
  onAIState(fn: (state: AIState) => void): () => void;
  onAIConversation(fn: (conversation: AIConversation) => void): () => void;
  onAIDelta(
    fn: (event: {
      projectId: string;
      profileId: string;
      requestId: string;
      delta: string;
    }) => void,
  ): () => void;
  /** The running message while the agent works; other messages are unchanged. */
  onAIMessage(
    fn: (event: {
      projectId: string;
      profileId: string;
      message: AIMessage;
    }) => void,
  ): () => void;
  readPdfAnnotations(
    id: string,
    url: string,
  ): Promise<import("./pdf-types").AnnotatedPdfData>;
  savePdfAnnotations(
    id: string,
    url: string,
    annotations: import("./pdf-types").PdfAnnotation[],
    pageCount: number,
  ): Promise<{ key: string; updatedAt: string }>;
  pdfAnnotationLibrary(id: string): Promise<import("./pdf-types").PdfVersion[]>;
  openAnnotatedPdf(
    id: string,
    key: string,
  ): Promise<{ url: string; name: string }>;
  exportAnnotatedPdf(
    id: string,
    url: string,
    annotations: import("./pdf-types").PdfAnnotation[],
    pageCount: number,
  ): Promise<boolean>;
  load(): Promise<Workspace>;
  save(state: Workspace): Promise<boolean>;
  exportWorkspace(): Promise<boolean>;
  importWorkspace(): Promise<Workspace | null>;
  researchCatalog(): Promise<ResearchCatalog>;
  addResearchProjects(ids: string[]): Promise<Workspace>;
  deadlineFeed(): Promise<DeadlineFeedResult>;
  refreshDeadlineFeed(): Promise<DeadlineFeedResult>;
  trackConferenceDates(keys: string[]): Promise<Workspace>;
  acceptDeadlineUpdates(ids: string[]): Promise<Workspace>;
  importMacDeadlines(): Promise<{ state: Workspace; count: number }>;
  onDeadlineFeed(fn: (result: DeadlineFeedResult) => void): () => void;
  deadlineUpdates(): Promise<DeadlineUpdate[]>;
  /** `mainFile` is the entry file main picks from the folder's files, or "". */
  chooseFolder(
    id: string,
  ): Promise<{ folder: string; files: string[]; mainFile: string } | null>;
  listFiles(id: string): Promise<string[]>;
  projectFiles(id: string): Promise<ProjectFileRoot[]>;
  gitStatus(id: string, rootId: string): Promise<GitStatus>;
  gitInit(id: string, rootId: string): Promise<GitStatus>;
  gitDiff(id: string, rootId: string, file: string): Promise<GitDiff>;
  gitConnect(id: string, rootId: string, url: string): Promise<GitStatus>;
  gitCommit(
    id: string,
    rootId: string,
    message: string,
    files?: string[],
  ): Promise<GitStatus>;
  gitSync(
    id: string,
    rootId: string,
    direction: "fetch" | "pull" | "push" | "sync",
  ): Promise<GitStatus>;
  readFile(id: string, file: string, rootId?: string): Promise<string>;
  openProjectReference(
    id: string,
    reference: string,
    rootId?: string,
    action?: "open" | "reveal",
  ): Promise<
    | { kind: "text"; file: string; rootId: string; line?: number }
    | { kind: "pdf"; url: string; name: string }
    | { kind: "finder" }
  >;
  fileMtime(id: string, file: string, rootId?: string): Promise<number>;
  /**
   * Resolves to the new mtimeMs. With `expectedMtime`, rejects with a message
   * starting "Changed on disk" when the file on disk has another mtime.
   */
  writeFile(
    id: string,
    file: string,
    content: string,
    rootId?: string,
    expectedMtime?: number,
  ): Promise<number>;
  /** `name` is a path relative to the root, in a folder that exists. */
  createFile(id: string, name: string, rootId?: string): Promise<boolean>;
  /** Rejects instead of replacing an existing file. */
  renameFile(
    id: string,
    rootId: string,
    from: string,
    to: string,
  ): Promise<void>;
  trashFile(id: string, rootId: string, file: string): Promise<void>;
  restorePdf(
    id: string,
    key: string,
    keepArchived?: boolean,
  ): Promise<{ url: string; name: string }>;
  lastPdf(id: string): Promise<{ url: string; name: string } | null>;
  choosePdf(id: string): Promise<{ url: string; name: string } | null>;
  /** `pdf` keeps the same URL while the PDF's size and mtime are unchanged. */
  compile(
    id: string,
  ): Promise<{ ok: boolean; log: string; pdf: string | null }>;
  /** Compiles a latexdiff against `revision` into .research-build/diff. */
  compileDiff(
    id: string,
    revision: string,
  ): Promise<{ ok: boolean; log: string; pdf: string | null }>;
  cancelCompile(id: string): Promise<void>;
  /** `url` is the PDF on screen, which must be the compiled manuscript. */
  synctexForward(
    id: string,
    file: string,
    line: number,
    rootId: string,
    url: string,
  ): Promise<import("./pdf-types").PdfTarget | null>;
  synctexInverse(
    id: string,
    page: number,
    x: number,
    y: number,
    pdfUrl: string,
  ): Promise<{ file: string; rootId: string; line: number } | null>;
  onCompileOutput(
    fn: (data: { projectId: string; text: string }) => void,
  ): () => void;
  startTerminal(
    id: string,
    mode: "local" | "ssh",
  ): Promise<{ key: string; history: string }>;
  writeTerminal(key: string, text: string): Promise<void>;
  resizeTerminal(key: string, cols: number, rows: number): Promise<void>;
  stopTerminal(key: string): Promise<void>;
  onTerminalData(fn: (data: { key: string; text: string }) => void): () => void;
  onTerminalExit(
    fn: (data: { key: string; exitCode: number }) => void,
  ): () => void;
  openLink(url: string): Promise<void>;
  /** Shows the root, or `file` inside it, in Finder. */
  revealFolder(id: string, rootId?: string, file?: string): Promise<void>;
  info(): Promise<{ dataPath: string; version: string }>;
}
export interface AIErrorInfo {
  code: string;
  message: string;
  status?: number;
  requestId?: string;
  param?: string;
  networkCode?: string;
}
export type AIResult<T> =
  { ok: true; value: T } | { ok: false; error: AIErrorInfo };
export interface AISession {
  status: "disconnected" | "connecting" | "connected" | "reauth_required";
  sharing: boolean;
  activeProfileId: string | null;
  profiles: {
    id: string;
    label: string;
    email?: string;
    name?: string;
    status: AISession["status"];
    sharing: boolean;
  }[];
  error?: AIErrorInfo;
}
export type AIPermissionMode =
  "default" | "auto-review" | "read-only" | "full-access";
export interface AIModel {
  slug: string;
  displayName: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
  defaultReasoningEffort?: string;
  serviceTiers: { id: string; name: string; description: string }[];
}
export interface AIAgentSettings {
  permissionMode: AIPermissionMode;
  reasoningEffort?: string;
  serviceTier: string;
}
export interface AIState extends AISession {
  models: AIModel[];
  modelError?: AIErrorInfo;
  usage: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    unreportedRequests: number;
    lastUsedAt?: string;
  };
  runtime: { available: boolean; version?: string; error?: AIErrorInfo };
}
export interface AIContext {
  kind: "file" | "selection" | "pdf";
  documentKey?: string;
  page?: number;
  file: string;
  rootId: string;
  text: string;
}
export interface AISkill {
  id: string;
  name: string;
  displayName: string;
  description: string;
  scope: "user" | "repo" | "system" | "admin";
  enabled: boolean;
}
export interface AISkillCatalog {
  skills: AISkill[];
  warnings: number;
}
export interface AIMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  model?: string;
  permissionMode?: AIPermissionMode;
  permissionNote?: string;
  reasoningEffort?: string;
  serviceTier?: string;
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  attachments?: { name: string; kind: string }[];
  skills?: { name: string; displayName: string }[];
  usage?: { inputTokens: number; outputTokens: number };
  error?: AIErrorInfo;
  activities?: AIActivity[];
  approvals?: AIApproval[];
  diff?: string;
  review?: {
    files: number;
    revertedAt?: string;
    revertedFiles?: number;
    unavailable?: string;
  };
  plan?: { step: string; status: string }[];
}
export interface AIChangedFile {
  revertedAt?: string;
  canRevert?: boolean;
  reason?: string;
  id: string;
  path: string;
  absolutePath?: string;
  folder: string;
  kind: "added" | "deleted" | "modified";
  binary: boolean;
  beforeBytes: number;
  afterBytes: number;
  beforeMode?: number;
  afterMode?: number;
  snapshot?: false;
}
export interface AIChangeReview {
  files: AIChangedFile[];
  canRevert: boolean;
  reason?: string;
  revertedAt?: string;
  /** Final versions were saved at the next launch, after the app closed. */
  interrupted?: boolean;
  warnings: string[];
}
export interface AIPaperReview {
  canVerify?: boolean;
  note?: string;
  before?: {
    data?: Uint8Array;
    hash?: string;
    note?: string;
    warnings?: string[];
    capturedAt?: string;
  };
  after?: {
    data?: Uint8Array;
    hash?: string;
    note?: string;
    warnings?: string[];
    capturedAt?: string;
  };
  build?: { ok: boolean; log: string; warnings: string[]; at: string };
  interrupted?: boolean;
}
export interface AIReviewedFile extends AIChangedFile {
  before?: string;
  after?: string;
  diff: string;
  truncated?: boolean;
}
export interface AIActivity {
  id: string;
  type: string;
  status: string;
  command?: string;
  cwd?: string;
  output?: string;
  exitCode?: number;
  text?: string;
  changes?: { path: string; kind: unknown; diff: string }[];
}
export interface AIApproval {
  id: string;
  kind: "command" | "file" | "question" | "permissions";
  itemId?: string;
  reason?: string;
  command?: string;
  cwd?: string;
  grantRoot?: string;
  network?: { host?: string; protocol?: string };
  permissions?: {
    network?: { enabled?: boolean | null };
    fileSystem?: {
      read?: string[] | null;
      write?: string[] | null;
      entries?:
        | {
            access: "read" | "write" | "deny";
            path:
              | { type: "path"; path: string }
              | { type: "glob_pattern"; pattern: string }
              | {
                  type: "special";
                  value: {
                    kind: string;
                    path?: string;
                    subpath?: string | null;
                  };
                };
          }[]
        | null;
    };
  };
  canAccept?: boolean;
  questions?: {
    id: string;
    header?: string;
    question: string;
    options?: { label: string; description?: string }[];
  }[];
}
export type AIChatAction =
  "new" | "select" | "rename" | "archive" | "unarchive" | "delete";
export interface AIChatSummary {
  id: string;
  title: string;
  archived: boolean;
  updatedAt: string;
  active: boolean;
}
export interface AIConversation {
  chatId?: string;
  title?: string;
  projectId: string;
  profileId: string | null;
  agentRootId?: string;
  messages: AIMessage[];
  queue?: AIQueuedRequest[];
  queuePaused?: boolean;
  queueError?: AIErrorInfo;
}
export interface AIQueuedRequest {
  id: string;
  text: string;
  createdAt: string;
  model: string;
  permissionMode: AIPermissionMode;
  reasoningEffort?: string;
  serviceTier: string;
  attachments: { name: string; kind: AIContext["kind"] }[];
  skills: { name: string; displayName: string }[];
}
declare global {
  interface Window {
    research?: ResearchAPI;
  }
}
export const stages: { id: Stage; name: string }[] = [
  { id: "exploration", name: "Idea Exploration" },
  { id: "experiments", name: "Experiments" },
  { id: "writing", name: "Paper Writing" },
  { id: "submitted", name: "Submitted" },
  { id: "revision", name: "Revision" },
  { id: "accepted", name: "Accepted" },
  { id: "published", name: "Published" },
];
export const stageName = Object.fromEntries(
  stages.map((s) => [s.id, s.name]),
) as Record<Stage, string>;
export const VIEWS = [
  "overview",
  "board",
  "deadlines",
  "details",
  "workbench",
  "settings",
  "collection",
] as const;
export type View = (typeof VIEWS)[number];
export type Navigate = (
  view: View,
  /** `then` runs once the view is shown, after any unsaved-edits prompt. */
  options?: { projectId?: string; area?: string; then?: () => void },
) => void;
/** Resolves false when the save failed; the failure is already reported. */
export type Commit = (
  transform: (state: Workspace) => Workspace,
) => Promise<boolean>;
export type CommitWithUndo = (
  label: string,
  transform: (state: Workspace) => Workspace,
) => Promise<boolean>;
/** A function of the latest project keeps newer edits when a save is retried. */
export type ProjectChanges =
  Partial<Project> | ((project: Project) => Partial<Project>);
export type UpdateProject = (
  id: string,
  changes: ProjectChanges,
  undo?: string,
) => Promise<boolean>;
export const deadlineKinds: { id: DeadlineKind; name: string }[] = [
  { id: "abstract", name: "Abstract" },
  { id: "submission", name: "Paper" },
  { id: "notification", name: "Decision" },
  { id: "revision", name: "Revision" },
  { id: "camera-ready", name: "Camera-ready" },
  { id: "other", name: "Milestone" },
];
