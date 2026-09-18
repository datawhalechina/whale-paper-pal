import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Check,
  Eye,
  EyeOff,
  Languages,
  LoaderCircle,
  MonitorCog,
  Moon,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  Volume2,
  WandSparkles,
  X,
} from "lucide-react";
import type { AgentAccessMode, AgentRuntimeId, AiFeature, AiModelConfig, AiProvider, AiReasoningEffort, AiSettings } from "../types";
import {
  AI_PROVIDER_PRESETS,
  DEFAULT_AI_PROMPTS,
  fetchAvailableModels,
  providerPreset,
  supportedReasoningEfforts,
  testAiConnection,
} from "../lib/ai";
import { fetchTtsModels } from "../lib/tts";
import { IconButton } from "./IconButton";
import { CodexPetSprite, DESKTOP_PET_SKINS, type CodexPetAnimation } from "./CodexPetSprite";
import { getAgentModelList, getAgentRuntimeStatus, type AgentModelInfo, type AgentRuntimeInfo } from "../features/writer/services/agent";

type SettingsDialogProps = {
  open: boolean;
  settings: AiSettings;
  focusSection?: "general" | "metadata" | "models" | "runtime" | "pet";
  onClose: () => void;
  onSave: (settings: AiSettings) => void;
};

type SettingsTab = "basic" | "models" | "runtime" | "appearance" | "desktopPet" | "prompts";
type ConnectionState = { kind: "idle" | "testing" | "success" | "error"; message: string };
type ModelDiscoveryState = { kind: "idle" | "loading" | "success" | "error"; message: string };
type PetImportState = { kind: "idle" | "success" | "error"; message: string };
type AgentModelState = { kind: "idle" | "loading" | "success" | "error"; models: AgentModelInfo[]; message: string };

const AGENT_RUNTIME_DEFAULTS: Record<AgentRuntimeId, { label: string; baseUrl: string; model: string; description: string }> = {
  claude_code: {
    label: "Claude Code",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-6",
    description: "Anthropic Claude Messages 兼容接口",
  },
  codex_runtime: {
    label: "Codex",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.5",
    description: "OpenAI Responses / Chat Completions 兼容接口",
  },
};

const REASONING_EFFORT_LABELS: Record<AiReasoningEffort, string> = {
  auto: "默认",
  low: "低",
  medium: "中",
  high: "高",
  max: "最大",
};

type ModelPickerProps = {
  label: string;
  models: string[];
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
};

function ModelPicker({ label, models, placeholder, value, onChange }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  return (
    <div className="settings-model-picker" ref={rootRef}>
      <input
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        aria-label={label}
        autoComplete="off"
        onChange={(event) => { onChange(event.target.value); setOpen(true); }}
        onFocus={() => { if (models.length) setOpen(true); }}
        onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
        placeholder={placeholder}
        role="combobox"
        value={value}
      />
      <button
        aria-label={`${label}列表`}
        aria-expanded={open}
        className="settings-model-picker-toggle"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="settings-model-picker-menu" id={listId} role="listbox">
          {models.length ? models.map((model) => (
            <button
              aria-selected={model === value}
              className={model === value ? "is-selected" : ""}
              key={model}
              onClick={() => { onChange(model); setOpen(false); }}
              role="option"
              type="button"
            >
              <span>{model}</span>
              {model === value && <Check size={14} />}
            </button>
          )) : <span className="settings-model-picker-empty">尚未获取可用模型</span>}
        </div>
      )}
    </div>
  );
}

const PROMPT_FIELDS: Array<{
  key: keyof AiSettings["prompts"];
  label: string;
  placeholder: string;
}> = [
  { key: "system", label: "全局回答偏好", placeholder: "例如：我具有机器学习背景；先给结论，再展开证据；专业术语保留英文。" },
  { key: "review", label: "论文解读偏好", placeholder: "例如：重点分析方法设计、消融实验和可复现性，局限部分要说明对结论的实际影响。" },
  { key: "explain", label: "解释偏好", placeholder: "例如：按研究生水平解释，先补充背景，公式逐个说明符号和推导作用。" },
  { key: "translation", label: "翻译偏好", placeholder: "例如：采用学术中文，首次出现的专业术语保留英文原词，不翻译公式与变量名。" },
  { key: "chat", label: "AI 讨论偏好", placeholder: "例如：回答先给直接结论，引用论文内证据，无法确定时明确标注。" },
];

const FEATURE_MODEL_FIELDS: Array<{ key: AiFeature; label: string; description: string }> = [
  { key: "review", label: "论文解读", description: "摘要、贡献、方法、实验与优缺点的结构化解读" },
  { key: "chat", label: "AI 对话", description: "围绕论文内容的连续问答与讨论" },
  { key: "desktopPet", label: "桌宠对话", description: "桌面精灵的论文问答与科研交流" },
  { key: "explain", label: "解释与关键词", description: "文本、公式、图像解释与关键概念提取" },
  { key: "translation", label: "翻译", description: "选区与整页翻译" },
  { key: "highlights", label: "自动高亮", description: "识别当前页的重要原句" },
  { key: "quiz", label: "论文问答游戏", description: "依据论文生成理解题目" },
];

export function SettingsDialog({ open, settings, focusSection = "general", onClose, onSave }: SettingsDialogProps) {
  const [draft, setDraft] = useState(settings);
  const [activeTab, setActiveTab] = useState<SettingsTab>("basic");
  const [showApiKey, setShowApiKey] = useState(false);
  const [showSemanticScholarKey, setShowSemanticScholarKey] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>({ kind: "idle", message: "" });
  const [modelDiscovery, setModelDiscovery] = useState<ModelDiscoveryState>({ kind: "idle", message: "" });
  const [petImport, setPetImport] = useState<PetImportState>({ kind: "idle", message: "" });
  const [editingFeature, setEditingFeature] = useState<AiFeature | null>(null);
  const [agentRuntimes, setAgentRuntimes] = useState<AgentRuntimeInfo[]>([]);
  const [agentModelState, setAgentModelState] = useState<Record<AgentRuntimeId, AgentModelState>>({
    claude_code: { kind: "idle", models: [], message: "" },
    codex_runtime: { kind: "idle", models: [], message: "" },
  });
  const [ttsModels, setTtsModels] = useState<string[]>([]);
  const [ttsModelStatus, setTtsModelStatus] = useState<{ kind: "idle" | "loading" | "success" | "error"; message: string }>({ kind: "idle", message: "" });
  const semanticScholarInputRef = useRef<HTMLInputElement>(null);
  const petSpriteInputRef = useRef<HTMLInputElement>(null);

  const refreshAgentRuntimes = (refresh = false) => {
    void getAgentRuntimeStatus({ paths: draft.agentPaths, refresh })
      .then(setAgentRuntimes)
      .catch(() => setAgentRuntimes([]));
  };

  useEffect(() => {
    setConnection({ kind: "idle", message: "" });
    setModelDiscovery({ kind: "idle", message: "" });
    setPetImport({ kind: "idle", message: "" });
    setTtsModels([]);
    setTtsModelStatus({ kind: "idle", message: "" });
    if (open) {
      setDraft(settings);
      setEditingFeature(null);
      setActiveTab(focusSection === "models" ? "models" : focusSection === "runtime" ? "runtime" : focusSection === "pet" ? "desktopPet" : "basic");
    }
  }, [open, focusSection, settings]);

  useEffect(() => {
    if (!open || activeTab !== "desktopPet" || draft.desktopPetTts.provider !== "openai-tts") return;
    const baseUrl = draft.desktopPetTts.apiBaseUrl.trim();
    const apiKey = draft.desktopPetTts.apiKey.trim();
    if (!baseUrl || !apiKey) { setTtsModels([]); setTtsModelStatus({ kind: "idle", message: "填写 API 地址和 Key 后自动获取模型" }); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setTtsModelStatus({ kind: "loading", message: "正在获取 TTS 模型…" });
      void fetchTtsModels({ provider: "openai-tts", apiBaseUrl: baseUrl, apiKey }).then((models) => {
        if (cancelled) return;
        setTtsModels(models);
        setTtsModelStatus({ kind: "success", message: models.length ? `已获取 ${models.length} 个模型` : "服务未返回模型列表，可手动填写" });
      }).catch((error) => {
        if (cancelled) return;
        setTtsModels([]);
        setTtsModelStatus({ kind: "error", message: error instanceof Error ? error.message : "获取模型失败，可手动填写" });
      });
    }, 650);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activeTab, draft.desktopPetTts.apiBaseUrl, draft.desktopPetTts.apiKey, draft.desktopPetTts.provider, open]);

  const cancel = () => {
    setDraft(settings);
    setEditingFeature(null);
    onClose();
  };

  const save = () => {
    onSave(draft);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") editingFeature ? setEditingFeature(null) : cancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingFeature, open, settings]);

  useEffect(() => {
    if (!open || focusSection !== "metadata") return;
    const frame = window.requestAnimationFrame(() => {
      semanticScholarInputRef.current?.scrollIntoView({ block: "center" });
      semanticScholarInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusSection, open]);

  useEffect(() => {
    if (!open || activeTab !== "runtime") return;
    refreshAgentRuntimes();
  }, [activeTab, open]);

  if (!open) return null;

  const preset = providerPreset(draft.provider);
  const keyMissing = preset.apiKeyRequired && !draft.apiKey.trim();
  const canConnect = Boolean(draft.baseUrl.trim() && draft.defaultModel.trim() && !keyMissing);
  const canFetchModels = Boolean(draft.baseUrl.trim() && !keyMissing);
  const ttsProvider = draft.desktopPetTts.provider;
  const ttsExtra = (draft.desktopPetTts.extraConfigs[ttsProvider] || {}) as unknown as Record<string, string | number>;
  const setTtsExtra = (field: string, value: string | number | boolean) => setDraft((current) => ({
    ...current,
    desktopPetTts: {
      ...current.desktopPetTts,
      extraConfigs: { ...current.desktopPetTts.extraConfigs, [ttsProvider]: { ...(current.desktopPetTts.extraConfigs[ttsProvider] || {}), [field]: value } },
    },
  }));
  const setAgentAccessMode = (runtime: AgentRuntimeId, mode: AgentAccessMode) => {
    setDraft((current) => ({
      ...current,
      agentAccess: { ...(current.agentAccess || { claude_code: "direct", codex_runtime: "direct" }), [runtime]: mode },
      agentThirdParty: mode === "thirdparty" && !current.agentThirdParty?.[runtime]
        ? { ...(current.agentThirdParty || {}), [runtime]: { baseUrl: AGENT_RUNTIME_DEFAULTS[runtime].baseUrl, apiKey: "", model: AGENT_RUNTIME_DEFAULTS[runtime].model, models: [] } }
        : current.agentThirdParty || {},
    }));
  };
  const setAgentPath = (runtime: AgentRuntimeId, value: string) => {
    setDraft((current) => ({
      ...current,
      agentPaths: { ...(current.agentPaths || {}), [runtime]: value },
    }));
  };
  const setAgentThirdPartyField = (runtime: AgentRuntimeId, field: "baseUrl" | "apiKey" | "model", value: string) => {
    setDraft((current) => ({
      ...current,
      agentThirdParty: {
        ...(current.agentThirdParty || {}),
        [runtime]: {
          ...(current.agentThirdParty?.[runtime] || { baseUrl: AGENT_RUNTIME_DEFAULTS[runtime].baseUrl, apiKey: "", model: AGENT_RUNTIME_DEFAULTS[runtime].model, models: [] }),
          [field]: value,
        },
      },
    }));
  };
  const loadAgentModels = async (runtime: AgentRuntimeId, accessMode: AgentAccessMode, thirdParty: AiSettings["agentThirdParty"][AgentRuntimeId]) => {
    setAgentModelState((current) => ({ ...current, [runtime]: { ...current[runtime], kind: "loading", message: "正在获取模型…" } }));
    try {
      const models = await getAgentModelList(runtime, { accessMode, thirdParty, cliPath: draft.agentPaths?.[runtime] });
      setAgentModelState((current) => ({ ...current, [runtime]: { kind: "success", models, message: `已获取 ${models.length} 个模型` } }));
      if (accessMode === "thirdparty") {
        setDraft((current) => {
          const config = current.agentThirdParty?.[runtime] || { baseUrl: AGENT_RUNTIME_DEFAULTS[runtime].baseUrl, apiKey: "", model: AGENT_RUNTIME_DEFAULTS[runtime].model, models: [] };
          const ids = Array.from(new Set(models.map((item) => item.id)));
          return {
            ...current,
            agentThirdParty: { ...(current.agentThirdParty || {}), [runtime]: { ...config, models: ids, model: config.model || ids[0] || "" } },
          };
        });
      }
    } catch (error) {
      setAgentModelState((current) => ({ ...current, [runtime]: { ...current[runtime], kind: "error", message: error instanceof Error ? error.message : String(error) } }));
    }
  };
  const importPetSprite = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.(?:webp|png)$/i.test(file.name) || !["image/webp", "image/png", ""].includes(file.type)) {
      setPetImport({ kind: "error", message: "请选择 WebP 或 PNG 图集。" });
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setPetImport({ kind: "error", message: "图集不能超过 3 MB。" });
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("invalid-file"));
        reader.onerror = () => reject(reader.error || new Error("read-failed"));
        reader.readAsDataURL(file);
      });
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error("decode-failed"));
        image.src = dataUrl;
      });
      if (dimensions.width !== 1536 || dimensions.height !== 1872) {
        setPetImport({ kind: "error", message: `图集尺寸必须是 1536 × 1872，当前为 ${dimensions.width} × ${dimensions.height}。` });
        return;
      }
      setDraft((current) => ({
        ...current,
        desktopPet: { ...current.desktopPet, skin: "custom", customSpriteDataUrl: dataUrl, customSpriteName: file.name },
      }));
      setPetImport({ kind: "success", message: `已导入 ${file.name}` });
    } catch {
      setPetImport({ kind: "error", message: "无法读取该图集，请检查文件是否完整。" });
    }
  };

  const selectProvider = (provider: AiProvider) => {
    const next = providerPreset(provider);
    setDraft((current) => ({
      ...current,
      provider,
      baseUrl: next.baseUrl,
      defaultModel: next.models[0] || "",
      availableModels: next.models,
      defaultReasoningEffort: "auto",
      apiKey: provider === current.provider ? current.apiKey : "",
    }));
    setConnection({ kind: "idle", message: "" });
    setModelDiscovery({ kind: "idle", message: "" });
  };

  const fetchModels = async () => {
    if (!canFetchModels || modelDiscovery.kind === "loading") return;
    setModelDiscovery({ kind: "loading", message: "正在获取可用模型..." });
    try {
      const models = await fetchAvailableModels(draft);
      setDraft((current) => ({
        ...current,
        availableModels: models,
        defaultModel: models.includes(current.defaultModel) ? current.defaultModel : models[0],
        defaultReasoningEffort: models.includes(current.defaultModel) ? current.defaultReasoningEffort : "auto",
      }));
      setModelDiscovery({ kind: "success", message: `已获取 ${models.length} 个可用模型` });
    } catch (error) {
      setModelDiscovery({ kind: "error", message: error instanceof Error ? error.message : "无法获取模型列表。" });
    }
  };

  const testConnection = async () => {
    if (!canConnect || connection.kind === "testing") return;
    setConnection({ kind: "testing", message: "正在请求模型..." });
    try {
      const result = await testAiConnection(draft);
      setConnection({ kind: "success", message: `连接成功 · ${result}` });
    } catch (error) {
      setConnection({ kind: "error", message: error instanceof Error ? error.message : "无法连接模型。" });
    }
  };

  return (
    <div className="settings-layer" role="presentation">
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-titlebar">
          <h2 id="settings-title">设置</h2>
          <IconButton label="关闭设置" onClick={cancel}><X size={18} /></IconButton>
        </header>

        <form className="settings-form" onSubmit={(event) => { event.preventDefault(); save(); }}>
          <nav className="settings-nav" aria-label="设置分类">
            <button type="button" className={activeTab === "basic" ? "is-active" : ""} onClick={() => setActiveTab("basic")}>基本设置</button>
            <button type="button" className={activeTab === "models" ? "is-active" : ""} onClick={() => setActiveTab("models")}>模型接口设置</button>
            <button type="button" className={activeTab === "runtime" ? "is-active" : ""} onClick={() => setActiveTab("runtime")}>本地Agent设置</button>
            <button type="button" className={activeTab === "appearance" ? "is-active" : ""} onClick={() => setActiveTab("appearance")}>外观设置</button>
            <button type="button" className={activeTab === "desktopPet" ? "is-active" : ""} onClick={() => setActiveTab("desktopPet")}>桌面精灵</button>
            <button type="button" className={activeTab === "prompts" ? "is-active" : ""} onClick={() => setActiveTab("prompts")}>提示词个性化</button>
          </nav>

          <div className="settings-content">
            {activeTab === "basic" && (
              <div className="settings-page settings-basic-page">
                <section className="settings-section">
                  <div className="settings-section-heading">
                    <span className="settings-section-icon language"><Languages size={20} /></span>
                    <div><h3>语言</h3><p>选择您的首选语言。</p></div>
                  </div>
                  <label className="settings-field">
                    <span>界面与回答语言</span>
                    <select value={draft.language} onChange={(event) => setDraft({ ...draft, language: event.target.value as AiSettings["language"] })}>
                      <option value="zh-CN">简体中文 (Simplified Chinese)</option>
                      <option value="en-US">English (United States)</option>
                    </select>
                  </label>
                </section>

                <section className="settings-section">
                  <div className="settings-section-heading">
                    <span className="settings-section-icon citations"><BookOpen size={20} /></span>
                    <div><h3>文献元数据</h3><p>优先使用在线聚合与开放文献源；可选密钥提供独立的 Semantic Scholar 通道。</p></div>
                  </div>
                  <label className="settings-field">
                    <span>Semantic Scholar API Key（可选）</span>
                    <div className="settings-secret-input">
                      <input ref={semanticScholarInputRef} type={showSemanticScholarKey ? "text" : "password"} value={draft.semanticScholarApiKey} onChange={(event) => setDraft({ ...draft, semanticScholarApiKey: event.target.value })} placeholder="无需密钥也可解析 PDF" autoComplete="off" spellCheck={false} />
                      <button type="button" aria-label={showSemanticScholarKey ? "隐藏 Semantic Scholar API Key" : "显示 Semantic Scholar API Key"} title={showSemanticScholarKey ? "隐藏 Semantic Scholar API Key" : "显示 Semantic Scholar API Key"} onClick={() => setShowSemanticScholarKey((value) => !value)}>
                        {showSemanticScholarKey ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </div>
                    <small>不填写时仍会使用 Moonlight、OpenAlex 等来源并读取 PDF；密钥可在 <a href="https://www.semanticscholar.org/product/api#api-key" target="_blank" rel="noreferrer">Semantic Scholar 官网免费申请</a>。</small>
                  </label>
                </section>
              </div>
            )}

            {activeTab === "models" && (
              <div className="settings-page settings-models-page">
                <section className="settings-section model-settings-section">
                  <div className="settings-section-heading">
                    <span className="settings-section-icon model"><WandSparkles size={20} /></span>
                    <div><h3>模型服务</h3><p>连接一个云端或本地模型服务，并获取该服务当前可用的模型。</p></div>
                  </div>

                  <label className="settings-field">
                    <span>模型提供商</span>
                    <select value={draft.provider} onChange={(event) => selectProvider(event.target.value as AiProvider)}>
                      {AI_PROVIDER_PRESETS.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
                    </select>
                  </label>

                  <label className="settings-field">
                    <span>API 地址</span>
                    <input className="is-monospace" value={draft.baseUrl} onChange={(event) => { setDraft({ ...draft, baseUrl: event.target.value }); setModelDiscovery({ kind: "idle", message: "" }); }} placeholder={preset.baseUrl} spellCheck={false} />
                  </label>

                  <label className="settings-field">
                    <span>API Key{preset.apiKeyRequired ? "" : "（可选）"}</span>
                    <div className="settings-secret-input">
                      <input type={showApiKey ? "text" : "password"} value={draft.apiKey} onChange={(event) => { setDraft({ ...draft, apiKey: event.target.value }); setModelDiscovery({ kind: "idle", message: "" }); }} placeholder={preset.apiKeyPlaceholder} autoComplete="off" spellCheck={false} />
                      <button type="button" aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"} title={showApiKey ? "隐藏 API Key" : "显示 API Key"} onClick={() => setShowApiKey((value) => !value)}>
                        {showApiKey ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </div>
                    <small>密钥仅保存在这台设备的应用数据中，不会写入论文文件。</small>
                  </label>

                  <div className="settings-field settings-model-field">
                    <span>默认模型</span>
                    <div className="settings-model-input-row">
                      <ModelPicker
                        label="默认模型"
                        models={draft.availableModels}
                        onChange={(defaultModel) => setDraft({ ...draft, defaultModel, defaultReasoningEffort: "auto" })}
                        placeholder={preset.models[0] || "输入模型 ID"}
                        value={draft.defaultModel}
                      />
                      <button className="secondary-button settings-fetch-models-button" type="button" disabled={!canFetchModels || modelDiscovery.kind === "loading"} onClick={() => void fetchModels()}>
                        <RefreshCw className={modelDiscovery.kind === "loading" ? "is-spinning" : ""} size={15} />获取模型
                      </button>
                    </div>
                    {modelDiscovery.kind === "idle" && <small>未配置专有模型的功能都会使用此模型，也可直接输入模型 ID。</small>}
                    {modelDiscovery.kind !== "idle" && <small className={`settings-model-discovery-result is-${modelDiscovery.kind}`}>{modelDiscovery.message}</small>}
                  </div>

                  {(() => {
                    const levels = supportedReasoningEfforts({ provider: draft.provider, model: draft.defaultModel });
                    return levels.length > 0 && <label className="settings-field">
                      <span>推理强度</span>
                      <select value={levels.includes(draft.defaultReasoningEffort) ? draft.defaultReasoningEffort : "auto"} onChange={(event) => setDraft({ ...draft, defaultReasoningEffort: event.target.value as AiReasoningEffort })}>
                        {levels.map((level) => <option value={level} key={level}>{REASONING_EFFORT_LABELS[level]}</option>)}
                      </select>
                      <small>“默认”不向服务端发送推理等级，由当前模型自行决定。</small>
                    </label>;
                  })()}

                  <div className="settings-connection-row">
                    <button className="secondary-button settings-test-button" type="button" disabled={!canConnect || connection.kind === "testing"} onClick={() => void testConnection()}>
                      {connection.kind === "testing" ? <LoaderCircle className="is-spinning" size={15} /> : <Sparkles size={15} />}测试默认模型
                    </button>
                    {keyMissing && <span className="settings-connection-hint">填写 API Key 后可测试</span>}
                    {connection.kind !== "idle" && connection.kind !== "testing" && (
                      <span className={`settings-connection-result is-${connection.kind}`}>
                        {connection.kind === "success" && <Check size={14} />}{connection.message}
                      </span>
                    )}
                  </div>
                </section>

                <section className="settings-section settings-feature-models-section">
                  <div className="settings-section-heading">
                    <span className="settings-section-icon model"><Sparkles size={20} /></span>
                    <div><h3>专有模型</h3><p>为特定 AI 功能指定模型；保持“使用默认模型”即可自动回退。</p></div>
                  </div>
                  <div className="settings-feature-models">
                    {FEATURE_MODEL_FIELDS.map((field) => {
                      const config = draft.featureModels[field.key];
                      return (
                      <div className="settings-feature-model-row" key={field.key}>
                        <span><strong>{field.label}</strong><small>{field.description}</small></span>
                        <button type="button" onClick={() => setEditingFeature(field.key)}>
                          <span>{config && config.provider === draft.provider && config.baseUrl.replace(/\/+$/, "") === draft.baseUrl.replace(/\/+$/, "") ? `${providerPreset(config.provider).label} · ${config.model}` : config ? `旧配置已停用 · 使用默认模型 · ${draft.defaultModel || "尚未设置"}` : `使用默认模型 · ${draft.defaultModel || "尚未设置"}`}</span>
                          <ChevronRight size={15} />
                        </button>
                      </div>
                    )})}
                  </div>
                </section>
              </div>
            )}

            {activeTab === "runtime" && (
              <div className="settings-page settings-runtime-page">
                <section className="settings-section">
                  <div className="settings-section-heading">
                    <span className="settings-section-icon runtime"><MonitorCog size={20} /></span>
                    <div><h3>本地Agent设置</h3><p>选择论文 Agent 使用的执行引擎。模型列表会随 Runtime 自动切换。</p></div>
                  </div>
                  <label className="settings-field">
                    <span>默认 Runtime</span>
                    <select value={draft.agentRuntime} onChange={(event) => setDraft({ ...draft, agentRuntime: event.target.value as AgentRuntimeId })}>
                      <option value="claude_code">Claude Code</option>
                      <option value="codex_runtime">Codex</option>
                    </select>
                    <small>写作 Agent 打开时默认使用此 Runtime；对话框内仍可临时切换。</small>
                  </label>
                </section>
                <section className="settings-section settings-runtime-connectors">
                  <div className="settings-section-heading">
                    <span className="settings-section-icon runtime"><WandSparkles size={20} /></span>
                    <div><h3>本地 Agent 连接器</h3><p>检测本机是否安装并可调用对应 Runtime。</p></div>
                  </div>
                  <div className="settings-runtime-cards">
                    {(agentRuntimes.length ? agentRuntimes : [
                      { id: "claude_code", label: "Claude Code", available: false },
                      { id: "codex_runtime", label: "Codex", available: false },
                    ] as AgentRuntimeInfo[]).map((item) => {
                      const runtime = item.id as AgentRuntimeId;
                      const accessMode = draft.agentAccess?.[runtime] || "direct";
                      const thirdParty = draft.agentThirdParty?.[runtime] || { baseUrl: AGENT_RUNTIME_DEFAULTS[runtime].baseUrl, apiKey: "", model: AGENT_RUNTIME_DEFAULTS[runtime].model, models: [] };
                      const modelState = agentModelState[runtime];
                      const savedThirdParty = draft.agentThirdParty?.[runtime];
                      const thirdPartyConfigured = Boolean(savedThirdParty?.baseUrl.trim() && savedThirdParty?.model.trim());
                      const directAuthenticated = item.authenticated === true;
                      const runtimeReady = item.available && (accessMode === "thirdparty" || directAuthenticated);
                      return <article key={runtime} className={`settings-runtime-card ${runtimeReady ? "is-ready" : "is-missing"}`}>
                        <header>
                          <div><strong>{item.label}</strong><small>{item.available ? (accessMode === "thirdparty" ? "本地 CLI 可调用第三方接口" : directAuthenticated ? "本地 Runtime 已连接" : "CLI 已安装，但尚未登录") : thirdPartyConfigured ? "第三方配置已保存，仍需本地 CLI" : "未检测到本地 Runtime 或未登录"}</small></div>
                          <span className="settings-runtime-status-dot" aria-label={runtimeReady ? "已连接" : "未连接"} />
                          {item.version && <code>{item.version}</code>}
                        </header>
                        <div className="settings-runtime-access" role="group" aria-label={`${item.label} 接入方式`}>
                          <button type="button" className={accessMode === "direct" ? "is-active" : ""} aria-pressed={accessMode === "direct"} onClick={() => setAgentAccessMode(runtime, "direct")}><strong>直连</strong><small>使用本机登录和 Runtime 配置</small></button>
                          <button type="button" className={accessMode === "thirdparty" ? "is-active" : ""} aria-pressed={accessMode === "thirdparty"} onClick={() => setAgentAccessMode(runtime, "thirdparty")}><strong>第三方</strong><small>{AGENT_RUNTIME_DEFAULTS[runtime].description}</small></button>
                        </div>
                        <div className="settings-runtime-cli-config"><label className="settings-runtime-cli-path"><span>CLI 地址</span><input value={draft.agentPaths?.[runtime] || ""} onChange={(event) => setAgentPath(runtime, event.target.value)} placeholder="自动检测，可手动填写" spellCheck={false} /></label><button type="button" className="settings-runtime-models-button" onClick={() => refreshAgentRuntimes(true)}><RefreshCw size={13} />检测</button>{item.path && <small className="settings-runtime-path" title={item.path}>已使用：{item.path}</small>}</div>
                        {accessMode === "direct" ? <div className="settings-runtime-direct-note"><span>直连使用本机 {item.label} 的登录和配置。指定地址无效时会自动搜索系统路径。</span><button type="button" className="settings-runtime-models-button" disabled={!item.available || modelState.kind === "loading"} onClick={() => void loadAgentModels(runtime, accessMode, thirdParty)}><RefreshCw className={modelState.kind === "loading" ? "is-spinning" : ""} size={13} />获取模型</button>{modelState.message && <small className={`settings-runtime-models-message is-${modelState.kind}`}>{modelState.message}</small>}</div> : <div className="settings-runtime-thirdparty">
                          <label><span>API 地址</span><input value={thirdParty.baseUrl} onChange={(event) => setAgentThirdPartyField(runtime, "baseUrl", event.target.value)} placeholder={AGENT_RUNTIME_DEFAULTS[runtime].baseUrl} spellCheck={false} /></label>
                          <label><span>API Key（可选）</span><input type="password" value={thirdParty.apiKey} onChange={(event) => setAgentThirdPartyField(runtime, "apiKey", event.target.value)} placeholder={runtime === "claude_code" ? "sk-ant-..." : "sk-..."} autoComplete="off" spellCheck={false} /></label>
                          <label><span>模型</span><div className="settings-runtime-model-input"><input value={thirdParty.model} onChange={(event) => setAgentThirdPartyField(runtime, "model", event.target.value)} placeholder={AGENT_RUNTIME_DEFAULTS[runtime].model} list={`${runtime}-thirdparty-models`} spellCheck={false} /><button type="button" className="settings-runtime-models-button" disabled={!thirdParty.baseUrl.trim() || modelState.kind === "loading"} onClick={() => void loadAgentModels(runtime, accessMode, thirdParty)}><RefreshCw className={modelState.kind === "loading" ? "is-spinning" : ""} size={13} />获取</button></div><datalist id={`${runtime}-thirdparty-models`}>{Array.from(new Set([...(thirdParty.models || []), ...(modelState.models || []).map((item) => item.id), ...draft.availableModels])).map((model) => <option key={model} value={model} />)}</datalist>{modelState.message && <small className={`settings-runtime-models-message is-${modelState.kind}`}>{modelState.message}</small>}</label>
                          <small className="settings-runtime-thirdparty-note">兼容 OpenAI / Anthropic 的模型接口。填写后可在论文 Agent 对话框中选择。</small>
                        </div>}
                      </article>;
                    })}
                  </div>
                  <button className="secondary-button settings-runtime-refresh" type="button" onClick={() => refreshAgentRuntimes(true)}><RefreshCw size={15} />重新检测</button>
                </section>
              </div>
            )}

            {activeTab === "appearance" && (
              <div className="settings-page settings-appearance-page">
                <section className="settings-section">
                  <div className="settings-section-heading">
                    <span className="settings-section-icon appearance"><Sun size={20} /></span>
                    <div><h3>阅读外观</h3><p>设置新论文默认使用的页面主题。</p></div>
                  </div>
                  <div className="settings-field">
                    <span>默认文档主题</span>
                    <div className="settings-theme-options">
                      {([
                        { id: "original", label: "原色", icon: <Sun size={18} /> },
                        { id: "sepia", label: "护眼", icon: <Sparkles size={18} /> },
                        { id: "night", label: "夜间", icon: <Moon size={18} /> },
                      ] as const).map((item) => (
                        <button type="button" className={draft.appearance.documentTheme === item.id ? "is-active" : ""} onClick={() => setDraft({ ...draft, appearance: { ...draft.appearance, documentTheme: item.id } })} key={item.id}>
                          {item.icon}<span>{item.label}</span>{draft.appearance.documentTheme === item.id && <Check size={14} />}
                        </button>
                      ))}
                    </div>
                  </div>
                </section>

                <section className="settings-section">
                  <div className="settings-section-heading">
                    <span className="settings-section-icon motion"><Sparkles size={20} /></span>
                    <div><h3>界面动效</h3><p>控制滚动、加载和面板切换动画。</p></div>
                  </div>
                  <label className="settings-toggle-row">
                    <div><strong>减少动态效果</strong><small>关闭非必要动画，保留功能状态反馈。</small></div>
                    <input type="checkbox" checked={draft.appearance.reduceMotion} onChange={(event) => setDraft({ ...draft, appearance: { ...draft.appearance, reduceMotion: event.target.checked } })} />
                  </label>
                </section>
              </div>
            )}

            {activeTab === "desktopPet" && (
              <div className="settings-page settings-pet-page">
                <section className="settings-section">
                  <div className="settings-section-heading">
                    <span className="settings-section-icon desktop-pet-settings-icon"><MonitorCog size={20} /></span>
                    <div><h3>桌面精灵</h3><p>控制桌宠的显示方式、尺寸与点击行为。</p></div>
                  </div>
                  <label className="settings-toggle-row">
                    <div><strong>显示桌面精灵</strong><small>关闭主窗口后仍可从桌宠快速返回 WhalePaper。</small></div>
                    <input type="checkbox" checked={draft.desktopPet.enabled} onChange={(event) => setDraft({ ...draft, desktopPet: { ...draft.desktopPet, enabled: event.target.checked } })} />
                  </label>
                  <label className="settings-toggle-row">
                    <div><strong>始终置顶</strong><small>让桌宠保持在其他应用窗口上方。</small></div>
                    <input type="checkbox" checked={draft.desktopPet.alwaysOnTop} onChange={(event) => setDraft({ ...draft, desktopPet: { ...draft.desktopPet, alwaysOnTop: event.target.checked } })} />
                  </label>
                  <label className="settings-toggle-row">
                    <div><strong>推荐更新提醒</strong><small>有新的每日论文时显示气泡和提醒状态。</small></div>
                    <input type="checkbox" checked={draft.desktopPet.recommendationAlerts} onChange={(event) => setDraft({ ...draft, desktopPet: { ...draft.desktopPet, recommendationAlerts: event.target.checked } })} />
                  </label>
                  <label className="settings-toggle-row">
                    <div><strong>自动播放语音</strong><small>打开后，桌宠每次完成新回复都会自动朗读；关闭后不播放语音。</small></div>
                    <input type="checkbox" checked={draft.desktopPetTts.enabled && draft.desktopPetTts.autoPlay} onChange={(event) => setDraft({ ...draft, desktopPetTts: { ...draft.desktopPetTts, enabled: event.target.checked, autoPlay: event.target.checked } })} />
                  </label>
                </section>

                <section className="settings-section">
                  <div className="settings-section-heading">
                    <span className="settings-section-icon desktop-pet-settings-icon"><Volume2 size={20} /></span>
                    <div><h3>语音引擎</h3><p>系统语音无需 API；兼容接口可使用 OpenAI、Novamailio 或其他 /audio/speech 服务。</p></div>
                  </div>
                  <label className="settings-field"><span>引擎</span><select value={ttsProvider} onChange={(event) => setDraft({ ...draft, desktopPetTts: { ...draft.desktopPetTts, provider: event.target.value as AiSettings["desktopPetTts"]["provider"] } })}><option value="edge-tts">Edge TTS（在线免费）</option><option value="openai-tts">OpenAI TTS</option><option value="elevenlabs">ElevenLabs</option><option value="minimax-tts">MiniMax Audio</option><option value="fish-audio">Fish Audio</option><option value="browser">系统语音（无需 API）</option></select></label>
                  {ttsProvider !== "browser" && <>
                    {ttsProvider !== "edge-tts" && <label className="settings-field"><span>API Key</span><input type="password" value={draft.desktopPetTts.apiKey} onChange={(event) => setDraft({ ...draft, desktopPetTts: { ...draft.desktopPetTts, apiKey: event.target.value } })} placeholder="填写该服务的 API Key" /></label>}
                    <label className="settings-field"><span>Base URL</span><input value={draft.desktopPetTts.apiBaseUrl} onChange={(event) => setDraft({ ...draft, desktopPetTts: { ...draft.desktopPetTts, apiBaseUrl: event.target.value } })} placeholder={ttsProvider === "openai-tts" ? "https://api.openai.com/v1" : ttsProvider === "elevenlabs" ? "https://api.elevenlabs.io/v1" : ttsProvider === "minimax-tts" ? "https://api.minimax.io/v1" : ttsProvider === "fish-audio" ? "https://api.fish.audio" : "Edge TTS 由系统语音承载"} /></label>
                    {ttsProvider === "openai-tts" && <><label className="settings-field"><span>模型</span><input list="desktop-pet-tts-models" value={draft.desktopPetTts.model} onChange={(event) => setDraft({ ...draft, desktopPetTts: { ...draft.desktopPetTts, model: event.target.value } })} placeholder="填写 Key 后自动获取" /><datalist id="desktop-pet-tts-models">{ttsModels.map((model) => <option value={model} key={model} />)}</datalist></label>{ttsModelStatus.message && <p className={`settings-pet-import-result is-${ttsModelStatus.kind === "error" ? "error" : "success"}`}>{ttsModelStatus.message}</p>}<label className="settings-field"><span>声音</span><input value={ttsExtra.voice || draft.desktopPetTts.voice} onChange={(event) => setTtsExtra("voice", event.target.value)} placeholder="alloy" /></label><label className="settings-field"><span>输出格式</span><input value={ttsExtra.response_format || "mp3"} onChange={(event) => setTtsExtra("response_format", event.target.value)} placeholder="mp3" /></label><label className="settings-field"><span>超时（秒）</span><input type="number" min="5" max="600" value={ttsExtra.timeout ?? 60} onChange={(event) => setTtsExtra("timeout", Number(event.target.value))} /></label></>}
                    {ttsProvider === "elevenlabs" && <><label className="settings-field"><span>Voice ID</span><input value={ttsExtra.voice_id || ""} onChange={(event) => setTtsExtra("voice_id", event.target.value)} placeholder="EXAVITQu4vr4xnSDxMaL" /></label><label className="settings-field"><span>模型</span><input value={ttsExtra.model_id || "eleven_multilingual_v2"} onChange={(event) => setTtsExtra("model_id", event.target.value)} /></label><label className="settings-field"><span>输出格式</span><input value={ttsExtra.output_format || "mp3_44100_128"} onChange={(event) => setTtsExtra("output_format", event.target.value)} /></label><label className="settings-field"><span>稳定性（0-1）</span><input type="number" min="0" max="1" step="0.05" value={ttsExtra.stability ?? 0.5} onChange={(event) => setTtsExtra("stability", Number(event.target.value))} /></label><label className="settings-field"><span>相似度（0-1）</span><input type="number" min="0" max="1" step="0.05" value={ttsExtra.similarity_boost ?? 0.75} onChange={(event) => setTtsExtra("similarity_boost", Number(event.target.value))} /></label></>}
                    {ttsProvider === "minimax-tts" && <><label className="settings-field"><span>Group ID</span><input value={ttsExtra.group_id || ""} onChange={(event) => setTtsExtra("group_id", event.target.value)} /></label><label className="settings-field"><span>模型</span><input value={ttsExtra.model || "speech-02-hd"} onChange={(event) => setTtsExtra("model", event.target.value)} /></label><label className="settings-field"><span>Voice ID</span><input value={ttsExtra.voice_id || "female-shaonv"} onChange={(event) => setTtsExtra("voice_id", event.target.value)} /></label><label className="settings-field"><span>采样率</span><input type="number" value={ttsExtra.sample_rate ?? 32000} onChange={(event) => setTtsExtra("sample_rate", Number(event.target.value))} /></label><label className="settings-field"><span>比特率</span><input type="number" value={ttsExtra.bitrate ?? 128000} onChange={(event) => setTtsExtra("bitrate", Number(event.target.value))} /></label><label className="settings-field"><span>音频格式</span><input value={ttsExtra.audio_format || "mp3"} onChange={(event) => setTtsExtra("audio_format", event.target.value)} /></label></>}
                    {ttsProvider === "fish-audio" && <><label className="settings-field"><span>Reference ID</span><input value={ttsExtra.reference_id || ""} onChange={(event) => setTtsExtra("reference_id", event.target.value)} /></label><label className="settings-field"><span>模型</span><input value={ttsExtra.model || "s2-pro"} onChange={(event) => setTtsExtra("model", event.target.value)} /></label><label className="settings-field"><span>音频格式</span><input value={ttsExtra.audio_format || "mp3"} onChange={(event) => setTtsExtra("audio_format", event.target.value)} /></label><label className="settings-field"><span>MP3 比特率</span><input type="number" value={ttsExtra.mp3_bitrate ?? 128} onChange={(event) => setTtsExtra("mp3_bitrate", Number(event.target.value))} /></label><label className="settings-field"><span>延迟模式</span><input value={ttsExtra.latency || "normal"} onChange={(event) => setTtsExtra("latency", event.target.value)} /></label></>}
                    {ttsProvider === "edge-tts" && <><label className="settings-field"><span>Edge Voice</span><input value={ttsExtra.voice || "zh-CN-XiaoxiaoNeural"} onChange={(event) => setTtsExtra("voice", event.target.value)} placeholder="zh-CN-XiaoxiaoNeural" /></label><label className="settings-field"><span>Rate</span><input value={ttsExtra.rate || "+0%"} onChange={(event) => setTtsExtra("rate", event.target.value)} placeholder="+0%" /></label><label className="settings-field"><span>Volume</span><input value={ttsExtra.volume || "+0%"} onChange={(event) => setTtsExtra("volume", event.target.value)} placeholder="+0%" /></label><label className="settings-field"><span>Pitch</span><input value={ttsExtra.pitch || "+0Hz"} onChange={(event) => setTtsExtra("pitch", event.target.value)} placeholder="+0Hz" /></label></>}
                  </>}
                  <label className="settings-toggle-row"><div><strong>分句合成</strong><small>长回复按句拆分后依次播放。</small></div><input type="checkbox" checked={draft.desktopPetTts.splitEnabled} onChange={(event) => setDraft({ ...draft, desktopPetTts: { ...draft.desktopPetTts, splitEnabled: event.target.checked } })} /></label>
                  <label className="settings-field"><span>分句最大长度（{draft.desktopPetTts.maxSentenceLength}）</span><input type="number" min="5" max="100" value={draft.desktopPetTts.maxSentenceLength} onChange={(event) => setDraft({ ...draft, desktopPetTts: { ...draft.desktopPetTts, maxSentenceLength: Number(event.target.value) } })} /></label>
                  <label className="settings-field"><span>语速（{draft.desktopPetTts.rate.toFixed(2)}）</span><input type="range" min="0.5" max="2" step="0.05" value={draft.desktopPetTts.rate} onChange={(event) => setDraft({ ...draft, desktopPetTts: { ...draft.desktopPetTts, rate: Number(event.target.value) } })} /></label>
                  <label className="settings-field"><span>音量（{Math.round(draft.desktopPetTts.volume * 100)}%）</span><input type="range" min="0" max="1" step="0.05" value={draft.desktopPetTts.volume} onChange={(event) => setDraft({ ...draft, desktopPetTts: { ...draft.desktopPetTts, volume: Number(event.target.value) } })} /></label>
                </section>

                <section className="settings-section">
                  <div className="settings-section-heading">
                    <span className="settings-section-icon desktop-pet-settings-icon"><Sparkles size={20} /></span>
                    <div><h3>对话模型</h3><p>为桌宠聊天指定独立的大模型；未设置时使用默认模型。</p></div>
                  </div>
                  <div className="settings-feature-models">
                    <div className="settings-feature-model-row">
                      <span><strong>桌宠对话</strong><small>用于论文问答、研究思路和学术写作交流</small></span>
                      <button type="button" onClick={() => setEditingFeature("desktopPet")}>
                        <span>{draft.featureModels.desktopPet && draft.featureModels.desktopPet.provider === draft.provider && draft.featureModels.desktopPet.baseUrl.replace(/\/+$/, "") === draft.baseUrl.replace(/\/+$/, "") ? `${providerPreset(draft.featureModels.desktopPet.provider).label} · ${draft.featureModels.desktopPet.model}` : draft.featureModels.desktopPet ? `旧配置已停用 · 使用默认模型 · ${draft.defaultModel || "尚未设置"}` : `使用默认模型 · ${draft.defaultModel || "尚未设置"}`}</span>
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  </div>
                </section>

                <section className="settings-section">
                  <div className="settings-section-heading">
                    <span className="settings-section-icon desktop-pet-settings-icon"><Sparkles size={20} /></span>
                    <div><h3>精灵外观</h3><p>精灵大小与透明活动空间分开设置，避免遮挡桌面内容。</p></div>
                  </div>
                  <div className="settings-pet-import-row">
                    <div><strong>自定义图集</strong><small>{draft.desktopPet.customSpriteName || "导入兼容的动画图集"}</small></div>
                    <input ref={petSpriteInputRef} type="file" accept=".webp,.png,image/webp,image/png" onChange={(event) => void importPetSprite(event)} />
                    <button className="secondary-button" type="button" onClick={() => petSpriteInputRef.current?.click()}><Upload size={14} />导入图集</button>
                    {draft.desktopPet.customSpriteDataUrl && (
                      <button className="secondary-button" type="button" onClick={() => {
                        setDraft((current) => ({ ...current, desktopPet: { ...current.desktopPet, skin: "datawhale-spirit", customSpriteDataUrl: "", customSpriteName: "" } }));
                        setPetImport({ kind: "success", message: "已恢复为内置小鲸鱼。" });
                      }}><RotateCcw size={14} />恢复内置</button>
                    )}
                  </div>
                  {petImport.message && <p className={`settings-pet-import-result is-${petImport.kind}`}>{petImport.message}</p>}
                  <div className="settings-pet-skin-grid" aria-label="内置精灵选择">
                    {DESKTOP_PET_SKINS.map((skin) => (
                      <button
                        type="button"
                        key={skin.id}
                        className={draft.desktopPet.skin === skin.id ? "is-active" : ""}
                        aria-pressed={draft.desktopPet.skin === skin.id}
                        onClick={() => setDraft((current) => ({ ...current, desktopPet: { ...current.desktopPet, skin: skin.id } }))}
                      >
                        <CodexPetSprite animation="idle" size={0.62} skin={skin.id} />
                        <span><strong>{skin.label}</strong><small>{skin.description}</small></span>
                      </button>
                    ))}
                  </div>
                  <div className="settings-field settings-pet-control">
                    <span>精灵大小</span>
                    <div className="settings-pet-size-options">
                      {([
                        { value: 0.75, label: "小" },
                        { value: 1, label: "标准" },
                        { value: 1.15, label: "大" },
                      ] as const).map((item) => (
                        <button type="button" className={Math.abs(draft.desktopPet.avatarScale - item.value) < 0.01 ? "is-active" : ""} onClick={() => setDraft({ ...draft, desktopPet: { ...draft.desktopPet, avatarScale: item.value } })} key={item.value}>{item.label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-field settings-pet-control">
                    <span>活动空间</span>
                    <div className="settings-pet-space-options">
                      {([
                        { value: "compact", label: "紧凑", detail: "196 × 184" },
                        { value: "standard", label: "标准", detail: "232 × 216" },
                        { value: "spacious", label: "宽裕", detail: "280 × 260" },
                      ] as const).map((item) => (
                        <button type="button" className={draft.desktopPet.windowSize === item.value ? "is-active" : ""} onClick={() => setDraft({ ...draft, desktopPet: { ...draft.desktopPet, windowSize: item.value } })} key={item.value}><strong>{item.label}</strong><small>{item.detail}</small></button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-pet-preview" aria-label="桌宠状态预览">
                    {([
                      { animation: "idle", label: "空闲" },
                      { animation: "running", label: "加载" },
                      { animation: "review", label: "新论文" },
                      { animation: "waving", label: "招手" },
                      { animation: "jumping", label: "跳跃" },
                      { animation: "waiting", label: "等待" },
                      { animation: "failed", label: "失败" },
                      { animation: "running-left", label: "向左" },
                      { animation: "running-right", label: "向右" },
                    ] satisfies Array<{ animation: CodexPetAnimation; label: string }>).map((item) => (
                      <figure key={item.animation}><CodexPetSprite animation={item.animation} size={0.72} skin={draft.desktopPet.skin} source={draft.desktopPet.customSpriteDataUrl || undefined} /><figcaption>{item.label}</figcaption></figure>
                    ))}
                  </div>
                </section>

                <section className="settings-section">
                  <div className="settings-section-heading">
                    <span className="settings-section-icon desktop-pet-settings-icon"><BookOpen size={20} /></span>
                    <div><h3>交互</h3><p>设置点击桌宠时进入的功能，以及桌宠的默认位置。</p></div>
                  </div>
                  <label className="settings-field">
                    <span>点击后打开</span>
                    <select value={draft.desktopPet.openTarget} onChange={(event) => setDraft({ ...draft, desktopPet: { ...draft.desktopPet, openTarget: event.target.value as AiSettings["desktopPet"]["openTarget"] } })}>
                      <option value="discovery">论文发现</option>
                      <option value="reader">论文库</option>
                      <option value="writer">论文写作</option>
                    </select>
                  </label>
                  <div className="settings-pet-position-row">
                    <button className="secondary-button" type="button" onClick={() => {
                      if (!window.__TAURI_INTERNALS__) return;
                      void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().emitTo("pet", "desktop-pet-reset-position"));
                    }}>恢复到右下角</button>
                    <small>桌宠仍可直接拖动到任意位置。</small>
                  </div>
                </section>
              </div>
            )}

            {activeTab === "prompts" && (
              <div className="settings-page settings-prompts-page">
                <div className="settings-prompts-intro">
                  <button type="button" onClick={() => setDraft({ ...draft, prompts: { ...DEFAULT_AI_PROMPTS } })}><RotateCcw size={14} />恢复默认</button>
                </div>
                {PROMPT_FIELDS.map((field) => (
                  <label className="settings-prompt-field" key={field.key}>
                    <span>{field.label}</span>
                    <textarea value={draft.prompts[field.key]} onChange={(event) => setDraft({ ...draft, prompts: { ...draft.prompts, [field.key]: event.target.value } })} placeholder={field.placeholder} rows={3} />
                  </label>
                ))}
              </div>
            )}
          </div>
          <footer className="settings-footer">
            <button className="secondary-button" type="button" onClick={cancel}>取消</button>
            <button className="primary-button" type="submit">保存</button>
          </footer>
        </form>
      </section>
      {editingFeature && (() => {
        const field = FEATURE_MODEL_FIELDS.find((item) => item.key === editingFeature)!;
        return <FeatureModelDialog
          field={field}
          baseSettings={draft}
          initialConfig={draft.featureModels[editingFeature]}
          onClose={() => setEditingFeature(null)}
          onRemove={() => {
            setDraft((current) => {
              const featureModels = { ...current.featureModels };
              delete featureModels[editingFeature];
              return { ...current, featureModels };
            });
            setEditingFeature(null);
          }}
          onChange={(config) => {
            setDraft((current) => ({ ...current, featureModels: { ...current.featureModels, [editingFeature]: config } }));
          }}
        />;
      })()}
    </div>
  );
}

type FeatureModelDialogProps = {
  field: { key: AiFeature; label: string; description: string };
  baseSettings: AiSettings;
  initialConfig?: AiModelConfig;
  onClose: () => void;
  onRemove: () => void;
  onChange: (config: AiModelConfig) => void;
};

function FeatureModelDialog({ field, baseSettings, initialConfig, onClose, onRemove, onChange }: FeatureModelDialogProps) {
  const [draft, setDraft] = useState<AiModelConfig>(() => initialConfig || {
    provider: baseSettings.provider,
    baseUrl: baseSettings.baseUrl,
    apiKey: baseSettings.apiKey,
    model: baseSettings.defaultModel,
    availableModels: baseSettings.availableModels,
    reasoningEffort: baseSettings.defaultReasoningEffort,
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>({ kind: "idle", message: "" });
  const [discovery, setDiscovery] = useState<ModelDiscoveryState>({ kind: "idle", message: "" });
  const onChangeRef = useRef(onChange);
  const initializedRef = useRef(false);
  const preset = providerPreset(draft.provider);
  const keyMissing = preset.apiKeyRequired && !draft.apiKey.trim();
  const canFetchModels = Boolean(draft.baseUrl.trim() && !keyMissing);
  const canConnect = Boolean(draft.baseUrl.trim() && draft.model.trim() && !keyMissing);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    onChangeRef.current(draft);
  }, [draft]);

  const selectProvider = (provider: AiProvider) => {
    const next = providerPreset(provider);
    setDraft({
      provider,
      baseUrl: next.baseUrl,
      apiKey: provider === draft.provider ? draft.apiKey : "",
      model: next.models[0] || "",
      availableModels: next.models,
      reasoningEffort: "auto",
    });
    setConnection({ kind: "idle", message: "" });
    setDiscovery({ kind: "idle", message: "" });
  };

  const fetchModels = async () => {
    if (!canFetchModels || discovery.kind === "loading") return;
    setDiscovery({ kind: "loading", message: "正在获取可用模型..." });
    try {
      const models = await fetchAvailableModels(draft);
      setDraft((current) => ({ ...current, availableModels: models, model: models.includes(current.model) ? current.model : models[0], reasoningEffort: models.includes(current.model) ? current.reasoningEffort : "auto" }));
      setDiscovery({ kind: "success", message: `已获取 ${models.length} 个可用模型` });
    } catch (error) {
      setDiscovery({ kind: "error", message: error instanceof Error ? error.message : "无法获取模型列表。" });
    }
  };

  const testConnection = async () => {
    if (!canConnect || connection.kind === "testing") return;
    setConnection({ kind: "testing", message: "正在请求模型..." });
    try {
      const result = await testAiConnection({
        ...baseSettings,
        provider: draft.provider,
        baseUrl: draft.baseUrl,
        apiKey: draft.apiKey,
        defaultModel: draft.model,
        availableModels: draft.availableModels,
      });
      setConnection({ kind: "success", message: `连接成功 · ${result}` });
    } catch (error) {
      setConnection({ kind: "error", message: error instanceof Error ? error.message : "无法连接模型。" });
    }
  };

  return (
    <div className="feature-model-dialog-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="feature-model-dialog" role="dialog" aria-modal="true" aria-labelledby="feature-model-dialog-title" onSubmit={(event) => event.preventDefault()}>
        <header>
          <div><h3 id="feature-model-dialog-title">{field.label}专有模型</h3><p>{field.description}</p></div>
          <div className="feature-model-header-actions">
            {initialConfig && <button className="feature-model-remove" type="button" onClick={onRemove}><Trash2 size={14} />使用默认模型</button>}
            <IconButton label="关闭专有模型设置" onClick={onClose}><X size={17} /></IconButton>
          </div>
        </header>
        <div className="feature-model-dialog-content">
          <label className="settings-field">
            <span>模型提供商</span>
            <select value={draft.provider} onChange={(event) => selectProvider(event.target.value as AiProvider)}>
              {AI_PROVIDER_PRESETS.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="settings-field">
            <span>API 地址</span>
            <input className="is-monospace" value={draft.baseUrl} onChange={(event) => { setDraft({ ...draft, baseUrl: event.target.value }); setDiscovery({ kind: "idle", message: "" }); }} placeholder={preset.baseUrl} spellCheck={false} />
          </label>
          <label className="settings-field">
            <span>API Key{preset.apiKeyRequired ? "" : "（可选）"}</span>
            <div className="settings-secret-input">
              <input type={showApiKey ? "text" : "password"} value={draft.apiKey} onChange={(event) => { setDraft({ ...draft, apiKey: event.target.value }); setDiscovery({ kind: "idle", message: "" }); }} placeholder={preset.apiKeyPlaceholder} autoComplete="off" spellCheck={false} />
              <button type="button" aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"} onClick={() => setShowApiKey((value) => !value)}>{showApiKey ? <EyeOff size={17} /> : <Eye size={17} />}</button>
            </div>
            <small>此 Key 只用于“{field.label}”，并仅保存在本机。</small>
          </label>
          <div className="settings-field settings-model-field">
            <span>模型</span>
            <div className="settings-model-input-row">
              <ModelPicker
                label={`${field.label}模型`}
                models={draft.availableModels}
                onChange={(model) => setDraft({ ...draft, model, reasoningEffort: "auto" })}
                placeholder={preset.models[0] || "输入模型 ID"}
                value={draft.model}
              />
              <button className="secondary-button settings-fetch-models-button" type="button" disabled={!canFetchModels || discovery.kind === "loading"} onClick={() => void fetchModels()}>
                <RefreshCw className={discovery.kind === "loading" ? "is-spinning" : ""} size={15} />获取模型
              </button>
            </div>
            {discovery.kind === "idle" && <small>可从当前服务商获取，也可直接输入模型 ID。</small>}
            {discovery.kind !== "idle" && <small className={`settings-model-discovery-result is-${discovery.kind}`}>{discovery.message}</small>}
          </div>
          {(() => {
            const levels = supportedReasoningEfforts(draft);
            return levels.length > 0 && <label className="settings-field">
              <span>推理强度</span>
              <select value={levels.includes(draft.reasoningEffort) ? draft.reasoningEffort : "auto"} onChange={(event) => setDraft({ ...draft, reasoningEffort: event.target.value as AiReasoningEffort })}>
                {levels.map((level) => <option value={level} key={level}>{REASONING_EFFORT_LABELS[level]}</option>)}
              </select>
              <small>仅对当前“{field.label}”使用；选择默认时使用模型自身的推理策略。</small>
            </label>;
          })()}
          <div className="settings-connection-row">
            <button className="secondary-button settings-test-button" type="button" disabled={!canConnect || connection.kind === "testing"} onClick={() => void testConnection()}>
              {connection.kind === "testing" ? <LoaderCircle className="is-spinning" size={15} /> : <Sparkles size={15} />}测试连接
            </button>
            {keyMissing && <span className="settings-connection-hint">填写 API Key 后可测试</span>}
            {connection.kind !== "idle" && connection.kind !== "testing" && <span className={`settings-connection-result is-${connection.kind}`}>{connection.kind === "success" && <Check size={14} />}{connection.message}</span>}
          </div>
        </div>
      </form>
    </div>
  );
}
