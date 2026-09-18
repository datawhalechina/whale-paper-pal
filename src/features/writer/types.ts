export type LatexEngine = "pdflatex" | "xelatex" | "lualatex";

export type LatexRuntimeStatus = {
  available: boolean;
  distribution?: string;
  version?: string;
  latexmkPath?: string;
  engines: LatexEngine[];
  biberAvailable: boolean;
  managed: boolean;
};

export type RuntimeInstallProgress = {
  phase: "preparing" | "downloading" | "verifying" | "installing" | "complete";
  message: string;
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
};

export type WriterFileEntry = {
  path: string;
  name: string;
  kind: string;
  size: number;
  editable: boolean;
};

export type WriterProject = {
  id: string;
  name: string;
  rootPath: string;
  mainFile?: string;
  files: WriterFileEntry[];
};

export type WriterLibraryProject = {
  id: string;
  name: string;
  rootPath: string;
  mainFile?: string;
  createdAt: number;
  lastOpenedAt: number;
  versionCount: number;
  openThreadCount: number;
  pendingRevisionCount: number;
  pathAvailable: boolean;
};

export type WriterVersion = {
  id: string;
  projectId: string;
  label: string;
  note: string;
  createdAt: number;
  fileCount: number;
};

export type WriterVersionDetail = Omit<WriterVersion, "fileCount"> & {
  files: Record<string, string>;
};

export type WriterThreadMessage = {
  id: string;
  body: string;
  createdAt: number;
  updatedAt: number;
};

export type WriterThread = {
  id: string;
  projectId: string;
  filePath: string;
  fromOffset: number;
  toOffset: number;
  quotedText: string;
  resolved: boolean;
  createdAt: number;
  updatedAt: number;
  messages: WriterThreadMessage[];
};

export type WriterRevision = {
  id: string;
  projectId: string;
  filePath: string;
  beforeContent: string;
  afterContent: string;
  status: "pending" | "accepted" | "rejected";
  createdAt: number;
  updatedAt: number;
};

export type WriterFileLocation = {
  rootPath: string;
  relativePath: string;
};

export type WriterSourcePosition = {
  filePath: string;
  line: number;
  column: number;
};

export type WriterPdfPosition = {
  page: number;
  x: number;
  y: number;
};

export type CompileDiagnostic = {
  file?: string;
  line?: number;
  severity: "error" | "warning";
  message: string;
};

export type CompileResult = {
  status: "success" | "failure" | "timedout";
  durationMs: number;
  log: string;
  diagnostics: CompileDiagnostic[];
  pdfAvailable: boolean;
};

export type EditorBuffer = {
  content: string;
  savedContent: string;
  saving: boolean;
};
