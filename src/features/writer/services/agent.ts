import { invoke } from "@tauri-apps/api/core";
import type { AgentAccessMode, AgentPaths, AgentThirdPartyConfig } from "../../../types";

export type AgentRuntimeId = "claude_code" | "codex_runtime";

export type AgentRuntimeInfo = {
  id: AgentRuntimeId;
  label: string;
  available: boolean;
  authenticated?: boolean | null;
  version?: string;
  path?: string;
};
export type AgentModelInfo = { id: string; label: string; isDefault: boolean; contextWindow?: number };

export type AgentFileChange = { path: string; content: string; reason?: string };
export type AgentReply = { message: string; changes: AgentFileChange[] };

export async function getAgentRuntimeStatus(options?: { paths?: AgentPaths; refresh?: boolean }): Promise<AgentRuntimeInfo[]> {
  return invoke<AgentRuntimeInfo[]>("agent_runtime_status", {
    request: { paths: options?.paths || {}, refresh: options?.refresh || false },
  });
}

export async function getAgentModelList(
  runtime: AgentRuntimeId,
  options?: { accessMode?: AgentAccessMode; thirdParty?: AgentThirdPartyConfig; cliPath?: string },
): Promise<AgentModelInfo[]> {
  return invoke<AgentModelInfo[]>("agent_model_list", {
    request: {
      runtime,
      accessMode: options?.accessMode,
      thirdParty: options?.thirdParty,
      cliPath: options?.cliPath,
    },
  });
}

function textFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFromUnknown).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return textFromUnknown(record.text ?? record.message ?? record.content ?? record.result ?? record.output);
}

function parseReply(value: unknown): AgentReply | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  // Codex `exec --json` emits JSONL events. The final answer is carried by
  // an `item.completed` event whose item has type `agent_message` and text.
  if ((record.type === "item.completed" || record.type === "item.started") && record.item && typeof record.item === "object") {
    return parseReply(record.item);
  }
  if (record.type === "agent_message" && typeof record.text === "string") {
    return parseReplyText(record.text) ?? { message: record.text, changes: [] };
  }
  // Runtime envelopes vary: Claude uses `result`, while Codex may wrap the
  // same payload in `output` or another result event. Keep unwrapping until
  // we reach the actual { message, changes } payload.
  if (record.result && typeof record.result === "object") {
    const nested = parseReply(record.result);
    if (nested) return nested;
  }
  if (record.output && typeof record.output === "object") {
    const nested = parseReply(record.output);
    if (nested) return nested;
  }
  const candidate = typeof record.result === "string"
    ? parseReplyText(record.result)
    : typeof record.output === "string"
      ? parseReplyText(record.output)
      : record;
  if (!candidate || typeof candidate !== "object") return null;
  const message = typeof (candidate as Record<string, unknown>).message === "string"
    ? String((candidate as Record<string, unknown>).message)
    : typeof (candidate as Record<string, unknown>).reply === "string"
      ? String((candidate as Record<string, unknown>).reply)
      : "";
  const rawChanges = (candidate as Record<string, unknown>).changes;
  const changes = Array.isArray(rawChanges) ? rawChanges.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const change = item as Record<string, unknown>;
    if (typeof change.path !== "string" || typeof change.content !== "string") return [];
    return [{ path: change.path, content: change.content, reason: typeof change.reason === "string" ? change.reason : undefined }];
  }) : [];
  return message || changes.length ? { message: message || "Agent 已生成修改。", changes } : null;
}

function parseReplyText(raw: string): AgentReply | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return parseReply(JSON.parse(cleaned)); } catch { /* try embedded JSON below */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return parseReply(JSON.parse(cleaned.slice(start, end + 1))); } catch { /* natural-language response */ }
  }
  return null;
}

export function parseAgentOutput(raw: string): AgentReply {
  const direct = parseReplyText(raw);
  if (direct) return direct;
  const fragments = raw.split(/\r?\n/).flatMap((line) => {
    try { return [JSON.parse(line) as unknown]; } catch { return []; }
  });
  for (const fragment of fragments.reverse()) {
    const parsed = parseReply(fragment);
    if (parsed) return parsed;
  }
  const text = fragments.map(textFromUnknown).filter(Boolean).join("\n") || raw.trim();
  return { message: text || "Agent 没有返回可显示的内容。", changes: [] };
}

export async function runWriterAgent(request: {
  rootPath: string;
  sessionId?: string;
  runtime: AgentRuntimeId;
  model?: string;
  permissionMode?: "full" | "plan";
  accessMode?: AgentAccessMode;
  thirdParty?: AgentThirdPartyConfig;
  cliPath?: string;
  skill?: "paper_check";
  prompt: string;
}): Promise<AgentReply> {
  const raw = await invoke<string>("run_writer_agent", { request });
  return parseAgentOutput(raw);
}

export async function stopWriterAgent(): Promise<void> {
  await invoke("stop_writer_agent");
}

export async function saveAgentMessage(sessionId: string, role: "user" | "assistant", body: string): Promise<void> {
  await invoke("save_agent_message", { request: { id: crypto.randomUUID(), sessionId, role, body } });
}

export async function listAgentMessages(sessionId: string): Promise<Array<{ id: string; role: "user" | "assistant"; content: string }>> {
  return invoke("list_agent_messages", { sessionId }) as Promise<Array<{ id: string; role: "user" | "assistant"; content: string }>>;
}

export async function saveAgentHandoff(sessionId: string, fromRuntime: AgentRuntimeId, toRuntime: AgentRuntimeId, summary: string): Promise<void> {
  await invoke("save_agent_handoff", { request: { id: crypto.randomUUID(), sessionId, fromRuntime, toRuntime, summary } });
}

export type UserMemory = { id: string; memoryType: string; title: string; content: string; confidence: number; updatedAt: number };

export async function saveUserMemory(memory: { id?: string; memoryType: string; title: string; content: string; source?: string }): Promise<void> {
  await invoke("save_user_memory", { request: { id: memory.id || crypto.randomUUID(), memoryType: memory.memoryType, title: memory.title, content: memory.content, source: memory.source } });
}

export async function listUserMemories(): Promise<UserMemory[]> {
  return invoke<UserMemory[]>("list_user_memories");
}
