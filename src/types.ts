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
  example?: boolean;
  catalogId?: string;
  topic?: string;
  icon?: string;
  sourceNote?: string;
  folderLabel?: string;
  localFolders?: LocalFolder[];
  links?: { label: string; url: string }[];
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
  areaLabelVersion?: 1 | 2;
  localFilesVersion?: 1;
  researchSetupVersion?: 1;
  flowWiseStatusVersion?: 1;
  deadlineImportVersion?: 1;
  webDeadlineSetupVersion?: 1;
  appearance?: Appearance;
  appearanceDefaultVersion?: 1;
  submissionPlanVersion?: 1;
  trackedDeadlines?: TrackedDeadline[];
  areas: Area[];
  projects: Project[];
}
export interface ResearchAPI {
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
  aiConversation(projectId: string): Promise<AIResult<AIConversation>>;
  aiSend(request: {
    projectId: string;
    message: string;
    model: string;
    rootId: string;
    context?: AIContext;
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
  chooseFolder(id: string): Promise<{ folder: string; files: string[] } | null>;
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
  openProjectReference(id: string, reference: string, rootId?: string): Promise<
    | { kind: "text"; file: string; rootId: string; line?: number }
    | { kind: "pdf"; url: string; name: string }
  >;
  writeFile(
    id: string,
    file: string,
    content: string,
    rootId?: string,
  ): Promise<boolean>;
  createFile(id: string, name: string): Promise<string[]>;
  lastPdf(id: string): Promise<{ url: string; name: string } | null>;
  choosePdf(id: string): Promise<{ url: string; name: string } | null>;
  compile(
    id: string,
  ): Promise<{ ok: boolean; log: string; pdf: string | null }>;
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
  revealFolder(id: string, rootId?: string): Promise<void>;
  info(): Promise<{ dataPath: string; version: string }>;
}
export interface AIErrorInfo {
  code: string;
  message: string;
  status?: number;
  requestId?: string;
  param?: string;
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
export interface AIState extends AISession {
  models: { slug: string; displayName: string }[];
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
  kind: "file" | "selection";
  file: string;
  rootId: string;
  text: string;
}
export interface AIMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  model?: string;
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  attachments?: { name: string; kind: string }[];
  usage?: { inputTokens: number; outputTokens: number };
  error?: AIErrorInfo;
  activities?: AIActivity[];
  approvals?: AIApproval[];
  diff?: string;
  plan?: { step: string; status: string }[];
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
  permissions?: unknown;
  canAccept?: boolean;
  questions?: {
    id: string;
    header?: string;
    question: string;
    options?: { label: string; description?: string }[];
  }[];
}
export interface AIConversation {
  projectId: string;
  profileId: string | null;
  agentRootId?: string;
  messages: AIMessage[];
}
declare global {
  interface Window {
    research?: ResearchAPI;
  }
}
export const stages: { id: Stage; name: string; color: string }[] = [
  { id: "exploration", name: "Idea Exploration", color: "#8eb7df" },
  { id: "experiments", name: "Experiments", color: "#d7b377" },
  { id: "writing", name: "Paper Writing", color: "#91b0e9" },
  { id: "submitted", name: "Submitted", color: "#b39bd7" },
  { id: "revision", name: "Revision", color: "#da9c84" },
  { id: "accepted", name: "Accepted", color: "#80c7ae" },
  { id: "published", name: "Published", color: "#92bace" },
];
export const deadlineKinds: { id: DeadlineKind; name: string }[] = [
  { id: "abstract", name: "Abstract" },
  { id: "submission", name: "Submission" },
  { id: "notification", name: "Decision" },
  { id: "revision", name: "Revision" },
  { id: "camera-ready", name: "Camera-ready" },
  { id: "other", name: "Milestone" },
];
export function dateLabel(date: string) {
  return new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
export function daysUntil(date: string) {
  const now = new Date();
  return Math.round(
    (new Date(date + "T00:00:00").getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86400000,
  );
}
export function dueLabel(date: string) {
  const days = daysUntil(date);
  return days === 0 ? "Today" : days < 0 ? `${-days}d ago` : `In ${days}d`;
}
