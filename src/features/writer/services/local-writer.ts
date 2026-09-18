import { invoke } from "@tauri-apps/api/core";
import type {
  CompileResult,
  LatexEngine,
  LatexRuntimeStatus,
  WriterFileLocation,
  WriterLibraryProject,
  WriterProject,
  WriterPdfPosition,
  WriterRevision,
  WriterSourcePosition,
  WriterThread,
  WriterVersion,
  WriterVersionDetail,
} from "../types";

export async function getLatexRuntimeStatus(): Promise<LatexRuntimeStatus> {
  return invoke<LatexRuntimeStatus>("get_latex_runtime_status");
}

export async function installManagedLatexRuntime(): Promise<LatexRuntimeStatus> {
  return invoke<LatexRuntimeStatus>("install_managed_latex_runtime");
}

export async function uninstallManagedLatexRuntime(): Promise<LatexRuntimeStatus> {
  return invoke<LatexRuntimeStatus>("uninstall_managed_latex_runtime");
}

export async function resolveWriterFile(filePath: string): Promise<WriterFileLocation> {
  return invoke<WriterFileLocation>("resolve_writer_file", { filePath });
}

export async function openWriterProject(rootPath: string, entryFile?: string): Promise<WriterProject> {
  return invoke<WriterProject>("open_writer_project", { rootPath, entryFile });
}

export async function readWriterFile(rootPath: string, relativePath: string): Promise<string> {
  return invoke<string>("read_writer_file", { rootPath, relativePath });
}

export async function writeWriterFile(rootPath: string, relativePath: string, content: string): Promise<void> {
  return invoke("write_writer_file", { rootPath, relativePath, content });
}

export async function compileWriterProject(rootPath: string, mainFile: string, engine: LatexEngine): Promise<CompileResult> {
  return invoke<CompileResult>("compile_writer_project", {
    request: { rootPath, mainFile, engine },
  });
}

export async function readWriterPdf(rootPath: string): Promise<Uint8Array> {
  const response = await invoke<ArrayBuffer | Uint8Array | number[]>("read_writer_pdf", { rootPath });
  if (response instanceof Uint8Array) return response;
  if (response instanceof ArrayBuffer) return new Uint8Array(response);
  return new Uint8Array(response);
}

export async function findWriterSourcePosition(
  rootPath: string,
  page: number,
  x: number,
  y: number,
): Promise<WriterSourcePosition> {
  return invoke<WriterSourcePosition>("writer_synctex_edit", {
    request: { rootPath, page, x, y },
  });
}

export async function findWriterPdfPosition(
  rootPath: string,
  filePath: string,
  line: number,
): Promise<WriterPdfPosition> {
  return invoke<WriterPdfPosition>("writer_synctex_view", {
    request: { rootPath, filePath, line },
  });
}

export async function listWriterLibrary(): Promise<WriterLibraryProject[]> {
  return invoke<WriterLibraryProject[]>("list_writer_library");
}

export async function removeWriterLibraryProject(projectId: string): Promise<void> {
  return invoke("remove_writer_library_project", { projectId });
}

export async function createWriterVersion(rootPath: string, mainFile: string, label: string, note = ""): Promise<WriterVersion> {
  return invoke<WriterVersion>("create_writer_version", { request: { rootPath, mainFile, label, note } });
}

export async function listWriterVersions(projectId: string): Promise<WriterVersion[]> {
  return invoke<WriterVersion[]>("list_writer_versions", { projectId });
}

export async function getWriterVersion(versionId: string): Promise<WriterVersionDetail> {
  return invoke<WriterVersionDetail>("get_writer_version", { versionId });
}

export async function restoreWriterVersion(versionId: string): Promise<void> {
  return invoke("restore_writer_version", { versionId });
}

export async function listWriterThreads(projectId: string): Promise<WriterThread[]> {
  return invoke<WriterThread[]>("list_writer_threads", { projectId });
}

export async function createWriterThread(request: {
  id: string; projectId: string; filePath: string; fromOffset: number; toOffset: number;
  quotedText: string; messageId: string; body: string;
}): Promise<void> {
  return invoke("create_writer_thread", { request });
}

export async function addWriterThreadMessage(threadId: string, body: string): Promise<void> {
  return invoke("add_writer_thread_message", { request: { id: crypto.randomUUID(), threadId, body } });
}

export async function updateWriterThreadMessage(messageId: string, body: string): Promise<void> {
  return invoke("update_writer_thread_message", { messageId, body });
}

export async function setWriterThreadResolved(threadId: string, resolved: boolean): Promise<void> {
  return invoke("set_writer_thread_resolved", { threadId, resolved });
}

export async function deleteWriterThread(threadId: string): Promise<void> {
  return invoke("delete_writer_thread", { threadId });
}

export async function saveWriterRevision(request: {
  id: string; projectId: string; filePath: string; beforeContent: string; afterContent: string;
}): Promise<void> {
  return invoke("save_writer_revision", { request });
}

export async function applyWriterRevision(revisionId: string, status: "accepted" | "rejected"): Promise<void> {
  return invoke("apply_writer_revision", { request: { revisionId, status } });
}

export async function listWriterRevisions(projectId: string): Promise<WriterRevision[]> {
  return invoke<WriterRevision[]>("list_writer_revisions", { projectId });
}

export async function setWriterRevisionStatus(revisionId: string, status: "accepted" | "rejected"): Promise<void> {
  return invoke("set_writer_revision_status", { revisionId, status });
}
