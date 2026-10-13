export interface SetupTool {
  id: string;
  name: string;
  purpose: string;
  url: string;
  available: boolean;
  path?: string;
  version?: string;
  message?: string;
}
export interface OverleafConflictContent {
  text?: string;
  binary: boolean;
  exists: boolean;
}
export interface OverleafTransaction {
  id: string;
  stage: string;
  baseHead: string;
  remoteHead: string;
  resultHead?: string;
  reviewToken: string;
  createdAt: string;
  updatedAt: string;
  files: { file: string; status: string }[];
  diff: { text: string; truncated: boolean };
  incomingDiff?: { text: string; truncated: boolean };
  conflicts: {
    file: string;
    base: OverleafConflictContent;
    local: OverleafConflictContent;
    remote: OverleafConflictContent;
  }[];
  error?: string;
  compile?: { ok: boolean; at: string; message: string; reviewToken: string };
}
export interface OverleafStatus {
  connected: boolean;
  connection?: {
    mode: "review" | "publish";
    projectUrl: string;
    gitUrl: string;
    folder: string;
    remoteBranch: string;
    lastFetchedAt?: string;
    lastPublishedAt?: string;
  };
  head?: string;
  remoteHead?: string;
  branch?: string;
  dirty?: boolean;
  changes?: { file: string; status: string }[];
  ahead?: number;
  behind?: number;
  transaction?: OverleafTransaction;
  secureStorageAvailable?: boolean;
}
export interface OverleafConnectInput {
  projectId?: string;
  name?: string;
  url: string;
  token?: string;
  mode: "review" | "publish";
  clone: boolean;
}
