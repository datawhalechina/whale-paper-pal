import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, ChevronDown, Code2, FileCode2, FolderOpen, LoaderCircle, LockKeyhole, Plus, SearchCheck, Send, Settings, WandSparkles, X } from "lucide-react";
import type { WriterProject } from "./types";
import type { AgentAccessMode, AgentPaths, AgentRuntimeId as SettingsAgentRuntimeId, AgentThirdPartyConfig } from "../../types";
import { getAgentModelList, getAgentRuntimeStatus, listAgentMessages, listUserMemories, runWriterAgent, saveAgentMessage, saveUserMemory, stopWriterAgent, type AgentFileChange, type AgentModelInfo, type AgentRuntimeId, type AgentRuntimeInfo, type UserMemory } from "./services/agent";
import { MarkdownContent } from "../../components/MarkdownContent";

type AgentMessage = { id: string; role: "user" | "assistant"; content: string; changes?: AgentFileChange[] };
type AgentTurnOptions = {
  clearDraft?: boolean;
  permissionMode?: "full" | "plan";
  skill?: "paper_check";
  activity?: "reply" | "paper-check";
};

type WriterAgentPanelProps = {
  project: WriterProject;
  rootPath: string;
  activePath: string | null;
  defaultRuntime?: SettingsAgentRuntimeId;
  agentAccess?: Partial<Record<SettingsAgentRuntimeId, AgentAccessMode>>;
  agentPaths?: AgentPaths;
  agentThirdParty?: Partial<Record<SettingsAgentRuntimeId, AgentThirdPartyConfig>>;
  configuredModels?: string[];
  files: Record<string, string>;
  onSaveAll: () => Promise<void>;
  onApplyChanges: (changes: AgentFileChange[]) => Promise<void>;
  onOpenSettings?: () => void;
  pendingPrompt?: { id: string; content: string };
  onPendingPromptHandled?: () => void;
};

const FALLBACK_MODELS: Record<AgentRuntimeId, AgentModelInfo[]> = {
  claude_code: [
    { id: "sonnet", label: "Sonnet", isDefault: true, contextWindow: 200_000 },
    { id: "opus", label: "Opus", isDefault: false, contextWindow: 200_000 },
    { id: "haiku", label: "Haiku", isDefault: false, contextWindow: 200_000 },
  ],
  codex_runtime: [
    { id: "gpt-5.6-sol", label: "GPT-5.6-Sol", isDefault: true, contextWindow: 272_000 },
    { id: "gpt-5.6-terra", label: "GPT-5.6-Terra", isDefault: false, contextWindow: 272_000 },
    { id: "gpt-5.6-luna", label: "GPT-5.6-Luna", isDefault: false, contextWindow: 272_000 },
    { id: "gpt-5.5", label: "GPT-5.5", isDefault: false, contextWindow: 272_000 },
    { id: "gpt-5.2", label: "GPT-5.2", isDefault: false, contextWindow: 272_000 },
  ],
};

const RUNTIME_KEY = "whalepaper.writer.agent-runtime";
const MODEL_KEY = "whalepaper.writer.agent-models";
const SESSION_KEY = "whalepaper.writer.agent-session:";
const DEFAULT_CONTEXT_WINDOW_K = 180;
const PAPER_CHECK_PROMPT = "请使用 whalepaper-paper-check skill 对当前 LaTeX 论文项目进行查错。";

function storedRuntime(): AgentRuntimeId {
  try { return localStorage.getItem(RUNTIME_KEY) === "codex_runtime" ? "codex_runtime" : "claude_code"; } catch { return "claude_code"; }
}

function storedModel(runtime: AgentRuntimeId): string | undefined {
  try {
    const values = JSON.parse(localStorage.getItem(MODEL_KEY) || "{}") as Record<string, unknown>;
    return typeof values[runtime] === "string" && values[runtime].trim() ? values[runtime] as string : undefined;
  } catch { return undefined; }
}

function rememberModel(runtime: AgentRuntimeId, model: string): void {
  try {
    const values = JSON.parse(localStorage.getItem(MODEL_KEY) || "{}") as Record<string, unknown>;
    localStorage.setItem(MODEL_KEY, JSON.stringify({ ...values, [runtime]: model }));
  } catch { /* optional preference */ }
}

function storedSession(rootPath: string): string {
  try {
    const key = `${SESSION_KEY}${rootPath}`;
    const current = localStorage.getItem(key);
    if (current?.trim()) return current;
    const created = crypto.randomUUID();
    localStorage.setItem(key, created);
    return created;
  } catch { return crypto.randomUUID(); }
}

function buildConversationHistory(messages: AgentMessage[], maxChars: number): string {
  if (maxChars <= 0) return "[历史会话因当前模型窗口已满而压缩]";
  const excerpts = messages.map((item) => {
    const text = item.content.trim();
    const excerpt = text.length > 8_000 ? `${text.slice(0, 8_000)}…` : text;
    return `${item.role === "user" ? "用户" : "Agent"}: ${excerpt}`;
  });
  const history = excerpts.join("\n");
  if (history.length <= maxChars) return history;
  return `[较早会话已按当前模型上下文窗口压缩]\n${history.slice(-maxChars)}`;
}

export function WriterAgentPanel(props: WriterAgentPanelProps) {
  const [runtimes, setRuntimes] = useState<AgentRuntimeInfo[]>([]);
  const [runtimeStatus, setRuntimeStatus] = useState<"loading" | "ready" | "error">("loading");
  const [runtime, setRuntime] = useState<AgentRuntimeId>(() => props.defaultRuntime || storedRuntime());
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<"reply" | "paper-check">("reply");
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);
  const [permissionMode, setPermissionMode] = useState<"full" | "plan">("full");
  const [models, setModels] = useState<AgentModelInfo[]>([]);
  const [model, setModel] = useState(() => storedModel(props.defaultRuntime || storedRuntime()) || "sonnet");
  const [codeMode, setCodeMode] = useState<"code" | "file" | "project">("code");
  const [menu, setMenu] = useState<"permission" | "model" | "runtime" | "context" | "attach" | null>(null);
  const [sessionId, setSessionId] = useState(() => storedSession(props.rootPath));
  const [memories, setMemories] = useState<UserMemory[]>([]);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const refreshRuntimeStatus = () => {
    setRuntimeStatus("loading");
    void getAgentRuntimeStatus({ paths: props.agentPaths })
      .then((next) => { setRuntimes(next); setRuntimeStatus("ready"); })
      .catch(() => { setRuntimes([]); setRuntimeStatus("error"); });
  };
  useEffect(() => { refreshRuntimeStatus(); }, [props.agentPaths?.claude_code, props.agentPaths?.codex_runtime]);
  useEffect(() => {
    let cancelled = false;
    void listAgentMessages(sessionId).then((stored) => {
      if (!cancelled && stored.length) setMessages(stored.map((item) => ({ id: item.id, role: item.role, content: item.content })));
    }).catch(() => { /* first-run database may not exist yet */ });
    return () => { cancelled = true; };
  }, [sessionId]);
  useEffect(() => { void listUserMemories().then(setMemories).catch(() => setMemories([])); }, []);
  const startNewSession = () => {
    void stopWriterAgent();
    const next = crypto.randomUUID();
    try { localStorage.setItem(`${SESSION_KEY}${props.rootPath}`, next); } catch { /* optional preference */ }
    setSessionId(next);
    setMessages([]);
    setDraft("");
    setError("");
    setMenu(null);
  };
  useEffect(() => () => { void stopWriterAgent(); }, []);
  useEffect(() => {
    if (!props.defaultRuntime || props.defaultRuntime === runtime) return;
    setRuntime(props.defaultRuntime);
    try { localStorage.setItem(RUNTIME_KEY, props.defaultRuntime); } catch { /* optional preference */ }
  }, [props.defaultRuntime]);
  useEffect(() => {
    if (!props.pendingPrompt) return;
    setDraft(props.pendingPrompt.content);
    setMenu(null);
    props.onPendingPromptHandled?.();
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }, [props.pendingPrompt?.id]);
  const selectedRuntime = runtimes.find((item) => item.id === runtime);
  const accessMode = props.agentAccess?.[runtime] || "direct";
  const thirdPartyConfig = props.agentThirdParty?.[runtime];
  const modelOptions: AgentModelInfo[] = accessMode === "thirdparty"
    ? Array.from(new Set([...(thirdPartyConfig?.models || []), thirdPartyConfig?.model].filter((value): value is string => Boolean(value?.trim())))).map((id, index) => ({ id, label: id, isDefault: index === 0, contextWindow: undefined }))
    : (models.length ? models : FALLBACK_MODELS[runtime]);
  const thirdPartyConfigured = accessMode === "thirdparty"
    && Boolean(thirdPartyConfig?.baseUrl?.trim() && thirdPartyConfig?.model?.trim());
  // Third-party mode supplies its own credentials; direct mode requires the
  // local Runtime's login probe to explicitly report an authenticated user.
  const runtimeReady = Boolean(
    selectedRuntime?.available
      && (accessMode === "thirdparty" || selectedRuntime.authenticated === true),
  );
  const connectionState = runtimeStatus === "loading"
    ? "checking"
    : runtimeReady
      ? "connected"
      : "disconnected";
  const connectionLabel = runtimeStatus === "loading"
    ? "正在连接"
    : runtimeReady
      ? (accessMode === "thirdparty" ? "第三方已连接" : "直连已连接")
      : "未连接";
  const canSend = Boolean(draft.trim() && !busy && runtimeReady && (accessMode === "direct" || thirdPartyConfigured));
  useEffect(() => {
    let cancelled = false;
    if (accessMode === "thirdparty") {
      setModels([]);
      return () => { cancelled = true; };
    }
    setModels([]);
    void getAgentModelList(runtime, { accessMode, thirdParty: thirdPartyConfig, cliPath: props.agentPaths?.[runtime] }).then((next) => {
      if (!cancelled && next.length) setModels(next);
    }).catch(() => {
      // Keep the runtime-specific fallback list when the provider is offline.
    });
    return () => { cancelled = true; };
  }, [runtime, accessMode, thirdPartyConfig]);
  useEffect(() => {
    if (!modelOptions.some((item) => item.id === model)) {
      const nextModel = modelOptions.find((item) => item.isDefault)?.id || modelOptions[0]?.id;
      if (nextModel) {
        setModel(nextModel);
        rememberModel(runtime, nextModel);
      }
    }
  }, [model, modelOptions, runtime]);
  useEffect(() => {
    if (accessMode !== "thirdparty") return;
    const configured = thirdPartyConfig?.model?.trim();
    if (configured && model !== configured) {
      setModel(configured);
      rememberModel(runtime, configured);
    }
  }, [accessMode, runtime, thirdPartyConfig?.model]);
  const selectedModelInfo = modelOptions.find((item) => item.id === model);
  const contextWindow = Math.max(
    1,
    Math.round((selectedModelInfo?.contextWindow || DEFAULT_CONTEXT_WINDOW_K * 1000) / 1000),
  );
  const maxContextChars = contextWindow * 1000 * 4;
  // Read project source up to the selected model's actual context window. The
  // remaining space is calculated for conversation history at send time.
  const sourceContextLimit = maxContextChars;
  const context = useMemo(() => {
    let used = 0;
    const parts: string[] = [];
    const entries = codeMode === "file" && props.activePath && props.files[props.activePath]
      ? [[props.activePath, props.files[props.activePath]] as [string, string]]
      : Object.entries(props.files);
    for (const [path, content] of entries) {
      if (used >= sourceContextLimit) break;
      const header = `\n--- ${path} ---\n`;
      const remaining = Math.max(0, sourceContextLimit - used - header.length);
      if (!remaining) break;
      const excerpt = content.slice(0, Math.min(60_000, remaining));
      parts.push(`${header}${excerpt}`);
      used += header.length + excerpt.length;
    }
    return parts.join("\n");
  }, [props.files, codeMode, props.activePath, sourceContextLimit]);

  const chooseRuntime = (value: AgentRuntimeId) => {
    if (value === runtime) { setMenu(null); return; }
    void stopWriterAgent();
    setRuntime(value);
    const nextAccess = props.agentAccess?.[value] || "direct";
    const nextModel = nextAccess === "thirdparty"
      ? props.agentThirdParty?.[value]?.model || props.agentThirdParty?.[value]?.models?.[0] || storedModel(value) || FALLBACK_MODELS[value][0].id
      : storedModel(value) || FALLBACK_MODELS[value][0].id;
    setModel(nextModel);
    rememberModel(value, nextModel);
    setMenu(null);
    try { localStorage.setItem(RUNTIME_KEY, value); } catch { /* optional preference */ }
  };

  const selectPermission = (value: "full" | "plan") => {
    if (value === "full" && permissionMode !== "full" && !window.confirm("完全访问权限允许 Agent 提出对项目文件的修改。应用修改前仍需你确认，是否继续？")) return;
    setPermissionMode(value);
    setMenu(null);
  };

  const contextTokens = Math.ceil(context.length / 4 / 1000);
  const contextFileCount = codeMode === "file" && props.activePath && props.files[props.activePath] ? 1 : Object.keys(props.files).length;
  const contextLabel = codeMode === "file" ? "当前文件" : "当前项目";

  const send = async (submittedPrompt = draft, options: AgentTurnOptions = {}) => {
    const prompt = submittedPrompt.trim();
    const isRememberCommand = prompt.startsWith("/remember ");
    if (!prompt || busy || (!isRememberCommand && !runtimeReady) || (!isRememberCommand && accessMode === "thirdparty" && !thirdPartyConfigured)) return;
    if (options.clearDraft !== false) setDraft("");
    setBusy(true); setActivity(options.activity || "reply"); setError("");
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", content: prompt }]);
    try {
      if (prompt.startsWith("/remember ")) {
        const content = prompt.slice("/remember ".length).trim();
        if (!content) throw new Error("请在 /remember 后填写要记住的内容");
        await saveUserMemory({ memoryType: "feedback", title: "用户偏好", content, source: "explicit" });
        setMemories((current) => [{ id: crypto.randomUUID(), memoryType: "feedback", title: "用户偏好", content, confidence: 1, updatedAt: Date.now() }, ...current]);
        setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: "已保存到长期记忆。", changes: [] }]);
        return;
      }
      await props.onSaveAll();
      // Let the selected model determine when compaction is needed. The
      // project context is already bounded by the same window; history gets
      // only the remaining budget after the current request overhead.
      const requestOverhead = 6_000 + prompt.length * 2;
      const historyBudget = maxContextChars - context.length - requestOverhead;
      const history = buildConversationHistory(messages, historyBudget);
      const memoryContext = memories.slice(0, 30).map((memory) => `- ${memory.title}：${memory.content}`).join("\n");
      const isDreamCommand = prompt === "/dream";
      const requestText = isDreamCommand
        ? "请根据这段会话中用户明确表达的角色、研究方向、写作偏好和协作习惯，整理一份简洁的长期用户画像。只保留对未来协作有帮助且不敏感的信息。"
        : prompt;
      const instruction = [
        `项目：${props.project.name}`,
        `当前文件：${props.activePath || "未选择"}`,
        memoryContext ? `长期记忆（仅作为偏好参考）：\n${memoryContext}` : "",
        `上下文：${context}`,
        history ? `之前对话：\n${history}` : "",
        `用户：${requestText}`,
      ].filter(Boolean).join("\n\n");
      const reply = await runWriterAgent({
        rootPath: props.rootPath,
        sessionId,
        runtime,
        model,
        permissionMode: options.permissionMode || permissionMode,
        accessMode,
        thirdParty: thirdPartyConfig,
        cliPath: props.agentPaths?.[runtime],
        skill: options.skill,
        prompt: instruction,
      });
      void saveAgentMessage(sessionId, "user", prompt);
      void saveAgentMessage(sessionId, "assistant", reply.message);
      if (isDreamCommand && reply.message.trim()) {
        await saveUserMemory({ memoryType: "profile", title: "长期用户画像", content: reply.message, source: "dream" });
        setMemories((current) => [{ id: crypto.randomUUID(), memoryType: "profile", title: "长期用户画像", content: reply.message, confidence: 1, updatedAt: Date.now() }, ...current]);
      }
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: reply.message, changes: reply.changes }]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally { setActivity("reply"); setBusy(false); }
  };

  const runPaperCheckSkill = () => {
    void send(PAPER_CHECK_PROMPT, {
      clearDraft: false,
      permissionMode: "plan",
      skill: "paper_check",
      activity: "paper-check",
    });
  };

  const apply = async (changes: AgentFileChange[]) => {
    if (!changes.length || applying) return;
    if (!window.confirm(`Agent 将修改 ${changes.length} 个文件，是否应用？`)) return;
    setApplying(true); setError("");
    try { await props.onApplyChanges(changes); setMessages((current) => current.map((item) => item.changes === changes ? { ...item, changes: [] } : item)); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : String(nextError)); }
    finally { setApplying(false); }
  };

  return <section className="writer-agent-panel" aria-label="论文 Agent 对话">
    <header className="writer-agent-header">
      <div className="writer-agent-heading"><Bot size={15} /><strong>论文 Agent</strong><small>{props.project.name}</small></div>
      <button type="button" className="writer-agent-new-session" aria-label="新建会话" title="新建会话" onClick={startNewSession}><Plus size={14} /></button>
      {props.onOpenSettings && <button type="button" className="writer-agent-settings" aria-label="打开本地Agent设置" title="打开本地Agent设置" onClick={props.onOpenSettings}><Settings size={14} /></button>}
      <span className={`writer-agent-connection is-${connectionState}`} aria-label={`Agent ${connectionLabel}`} title={`Agent ${connectionLabel}`}>
        <i aria-hidden="true" />{connectionLabel}
      </span>
    </header>
    {runtimeStatus === "loading" && <div className="writer-agent-empty"><LoaderCircle className="is-spinning" size={17} />正在检测 Claude Code / Codex</div>}
    {runtimeStatus === "error" && <div className="writer-agent-notice"><X size={14} />无法检测本地 Runtime。<button type="button" onClick={refreshRuntimeStatus}>重试</button></div>}
    {runtimeStatus === "ready" && runtimes.length === 0 && <div className="writer-agent-notice"><WandSparkles size={14} />未检测到可用的本地 Runtime，请先安装 Claude Code 或 Codex。</div>}
    {runtimeStatus === "ready" && runtimes.length > 0 && !runtimeReady && <div className="writer-agent-notice"><WandSparkles size={14} />请先安装并登录 {selectedRuntime?.label || "Claude Code 或 Codex"}，或在 Runtime 设置中配置连接。</div>}
    {accessMode === "thirdparty" && !thirdPartyConfigured && <div className="writer-agent-notice"><WandSparkles size={14} />第三方连接尚未配置完整，请填写 API 地址和模型（API Key 按服务要求填写）。{props.onOpenSettings && <button type="button" onClick={props.onOpenSettings}>打开设置</button>}</div>}
    <div className="writer-agent-messages" aria-live="polite">
      {!messages.length && <div className="writer-agent-welcome"><Bot size={40} /><strong>和 Agent 一起修改论文</strong><p>从一个问题开始，让 Agent 阅读项目、解释内容或直接提出论文修改。</p></div>}
      {messages.map((message) => <article className={`writer-agent-message is-${message.role}`} key={message.id}><div className="writer-agent-message-role">{message.role === "user" ? "你" : "Agent"}</div>{message.role === "assistant" ? <MarkdownContent className="writer-agent-markdown" content={message.content} /> : <p>{message.content}</p>}{message.changes && message.changes.length > 0 && <div className="writer-agent-changes"><strong>{message.changes.length} 个文件待修改</strong>{message.changes.map((change) => <div key={change.path}><span>{change.path}</span><small>{change.reason || "内容更新"}</small></div>)}<button type="button" disabled={applying} onClick={() => void apply(message.changes || [])}>{applying ? <LoaderCircle className="is-spinning" size={12} /> : <Check size={12} />}应用修改</button></div>}</article>)}
      {busy && <div className="writer-agent-thinking"><LoaderCircle className="is-spinning" size={14} />{activity === "paper-check" ? "Agent 正在使用论文查错 skill 检查项目…" : "Agent 正在阅读项目并生成建议…"}</div>}
    </div>
    {error && <div className="writer-agent-error"><X size={13} />{error}</div>}
    <form className="writer-agent-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <div className="writer-agent-input-shell">
        <textarea ref={composerRef} value={draft} rows={2} maxLength={6000} disabled={busy || !runtimeReady} placeholder="告诉 Agent 想如何修改论文…" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
        <div className="writer-agent-input-footer">
          <button type="button" className="writer-agent-tool" aria-label="添加上下文或命令" title="添加上下文或命令" onClick={() => setMenu(menu === "attach" ? null : "attach")}><Plus size={15} /></button>
          {menu === "attach" && <div className="writer-agent-menu writer-agent-attach-menu"><button type="button" onClick={() => { setCodeMode("file"); setMenu(null); }}><FileCode2 size={13} />添加当前文件</button><button type="button" onClick={() => { setCodeMode("project"); setMenu(null); }}><FolderOpen size={13} />添加整个项目</button><button type="button" onClick={() => { setDraft((current) => current ? `${current}\n/` : "/"); setMenu(null); }}><Code2 size={13} />插入命令</button><button type="button" onClick={() => { setDraft("/dream"); setMenu(null); }}>整理长期记忆</button><button type="button" onClick={() => { setDraft((current) => current ? `${current}\n请调用终端工具检查项目。` : "请调用终端工具检查项目。"); setMenu(null); }}>调用 CLI</button><button type="button" onClick={() => { setCodeMode("code"); setMenu(null); }}>清除上下文选择</button></div>}
          <button type="button" className="writer-agent-tool" aria-label="使用论文查错 skill" title="论文查错" disabled={busy || !runtimeReady || (accessMode === "thirdparty" && !thirdPartyConfigured)} onClick={runPaperCheckSkill}><SearchCheck size={15} /></button>
          <button type="button" className="writer-agent-permission" aria-label="权限模式" title="权限模式" onClick={() => setMenu(menu === "permission" ? null : "permission")}>
            <LockKeyhole size={11} />{permissionMode === "full" ? "完全访问权限" : "只读计划"} <ChevronDown size={11} />
          </button>
          {menu === "permission" && <div className="writer-agent-menu writer-agent-permission-menu"><button type="button" className={permissionMode === "full" ? "is-selected" : ""} onClick={() => selectPermission("full")}><LockKeyhole size={13} /><span><b>完全访问权限</b><small>允许 Agent 提出文件修改</small></span>{permissionMode === "full" && <Check size={13} />}</button><button type="button" className={permissionMode === "plan" ? "is-selected" : ""} onClick={() => selectPermission("plan")}><LockKeyhole size={13} /><span><b>只读计划</b><small>仅分析项目，不写入文件</small></span>{permissionMode === "plan" && <Check size={13} />}</button></div>}
          <span className="writer-agent-input-spacer" />
          <button type="button" className="writer-agent-model" aria-label="Agent 模型" onClick={() => setMenu(menu === "model" ? null : "model")}><span>{modelOptions.find((item) => item.id === model)?.label || modelOptions[0]?.label || model || "选择模型"}</span><ChevronDown size={11} /></button>
          {menu === "model" && <div className="writer-agent-menu writer-agent-model-menu">{modelOptions.map((item) => <button type="button" key={item.id} className={item.id === model ? "is-selected" : ""} onClick={() => { setModel(item.id); rememberModel(runtime, item.id); setMenu(null); }}><span>{item.label}</span>{item.isDefault && <small>默认</small>}{item.id === model && <Check size={13} />}</button>)}</div>}
          {busy ? <button type="button" className="writer-agent-submit" aria-label="Agent 执行中" title="Agent 执行中" disabled><LoaderCircle className="is-spinning" size={15} /></button> : <button type="submit" className="writer-agent-submit" aria-label="发送" title="发送" disabled={!canSend}><Send size={15} /></button>}
        </div>
      </div>
      <div className="writer-agent-runtime-row">
        <button type="button" className="writer-agent-runtime" aria-label="Agent runtime" onClick={() => setMenu(menu === "runtime" ? null : "runtime")}><span>{selectedRuntime?.label || "选择 runtime"}</span><ChevronDown size={11} /></button>
        {menu === "runtime" && <div className="writer-agent-menu writer-agent-runtime-menu">{(runtimes.length ? runtimes : [{ id: "claude_code", label: "Claude Code", available: false, authenticated: false }, { id: "codex_runtime", label: "Codex", available: false, authenticated: false }]).map((item) => { const itemReady = item.available && (props.agentAccess?.[item.id as AgentRuntimeId] === "thirdparty" || item.authenticated === true); return <button type="button" key={item.id} disabled={!itemReady} className={item.id === runtime ? "is-selected" : ""} onClick={() => chooseRuntime(item.id as AgentRuntimeId)}><span><b>{item.label}</b><small>{item.id === runtime ? (accessMode === "thirdparty" ? "第三方接入" : "直连接入") : itemReady ? "可用" : "未安装或未登录"}</small></span>{item.id === runtime && <Check size={13} />}</button>; })}{props.onOpenSettings && <><div className="writer-agent-menu-divider" /><button type="button" onClick={() => { setMenu(null); props.onOpenSettings?.(); }}><Settings size={13} />配置 Runtime</button></>}</div>}
        <span className="writer-agent-context-label">{contextLabel} · {contextFileCount} 个文件</span>
        <button type="button" className="writer-agent-token-count" aria-label="查看上下文窗口" onClick={() => setMenu(menu === "context" ? null : "context")}>{contextTokens}K</button>
        {menu === "context" && <div className="writer-agent-context-popover"><strong>上下文窗口</strong><div className="writer-agent-context-meter"><span style={{ width: `${Math.min(100, (contextTokens / contextWindow) * 100)}%` }} /></div><p>{contextTokens}K / {contextWindow}K tokens</p><small>{contextLabel} · {contextFileCount} 个文件</small></div>}
      </div>
    </form>
  </section>;
}
