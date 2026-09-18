import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AgentAccessMode, AgentRuntimeId, AiFeature, AiModelConfig, AiPromptSettings, AiProvider, AiReasoningEffort, AiSettings, ChatMessage } from "../types";
import { DEFAULT_DESKTOP_PET_SETTINGS, DEFAULT_DESKTOP_PET_TTS_SETTINGS, normalizeDesktopPetSettings, normalizeDesktopPetTtsSettings } from "./desktop-pet";
import { readBrandedStorage } from "./brand-storage";
import { parseStructuredJson, StructuredJsonParseError } from "./structured-json";

export type AiProviderPreset = {
  id: AiProvider;
  label: string;
  baseUrl: string;
  models: string[];
  apiKeyRequired: boolean;
  apiKeyPlaceholder: string;
};

export type AssistantContext = string | {
  session: string;
  turn?: string;
};

export type AiRequestOptions = {
  cacheAffinityKey?: string;
  cachePrefixMessages?: number;
  maxOutputTokens?: number;
  temperature?: number;
  jsonResponse?: boolean;
  /** Internal fallback for reasoning models that spend the whole budget thinking. */
  disableReasoning?: boolean;
  /** Internal model fallback used when a reasoning model exhausts its budget. */
  modelOverride?: string;
  /** Let the provider choose its own output limit for this request. */
  omitMaxOutputTokens?: boolean;
};

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", models: ["gpt-5-nano", "gpt-5-mini", "gpt-4.1-mini"], apiKeyRequired: true, apiKeyPlaceholder: "sk-..." },
  { id: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", models: ["claude-sonnet-4-5", "claude-haiku-4-5"], apiKeyRequired: true, apiKeyPlaceholder: "sk-ant-..." },
  { id: "gemini", label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", models: ["gemini-2.5-flash", "gemini-2.5-pro"], apiKeyRequired: true, apiKeyPlaceholder: "AIza..." },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com", models: ["deepseek-flash", "deepseek-pro"], apiKeyRequired: true, apiKeyPlaceholder: "sk-..." },
  { id: "moonshot", label: "Moonshot / Kimi", baseUrl: "https://api.moonshot.cn/v1", models: ["kimi-k2-turbo-preview", "moonshot-v1-32k"], apiKeyRequired: true, apiKeyPlaceholder: "sk-..." },
  { id: "qwen", label: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", models: ["qwen-plus", "qwen-turbo", "qwen-max"], apiKeyRequired: true, apiKeyPlaceholder: "sk-..." },
  { id: "ollama", label: "Ollama（本地）", baseUrl: "http://127.0.0.1:11434/v1", models: ["qwen3:8b", "deepseek-r1:8b", "llama3.2"], apiKeyRequired: false, apiKeyPlaceholder: "本地服务无需填写" },
  { id: "lmstudio", label: "LM Studio（本地）", baseUrl: "http://127.0.0.1:1234/v1", models: [], apiKeyRequired: false, apiKeyPlaceholder: "本地服务无需填写" },
  { id: "custom", label: "自定义 OpenAI-compatible", baseUrl: "http://127.0.0.1:8000/v1", models: [], apiKeyRequired: false, apiKeyPlaceholder: "可选" },
];

export const DEFAULT_AI_PROMPTS: AiPromptSettings = {
  system: "",
  review: "",
  explain: "",
  translation: "",
  chat: "",
};

export const BASE_SYSTEM_PROMPT = "你是一名严谨、客观且建设性的论文阅读助手。所有判断必须以提供的论文内容为依据；明确区分作者主张、论文证据、你的分析和无法核实的信息。不要编造引用、实验结果、章节位置或外部文献。";

export const AI_FEATURE_PROMPTS = {
  explain: "请以分层的方式解释所选内容，包括必要背景、推理过程、核心结论和研究意义。",
  review: [
    "请对单篇论文进行完整、深入且适合读者理解的结构化解读。目标是帮助用户理解论文，而不是模拟会议审稿；不要给出接受、拒绝、投稿建议或审稿分数。",
    "仅依据提供的 PDF 内容，明确区分作者主张、论文证据和你的解释。章节、图表、公式或数值只有在原文明确可见时才能引用，不要假装进行过外部文献检索。",
    "先识别论文类型与研究问题，再解释研究背景、核心贡献和方法流程。方法部分应说明关键机制、输入输出、重要假设及其为何能解决问题，而不只是复述术语。",
    "实验部分应梳理数据集或样本、对照或基线、指标、主要结果、消融或稳健性检验，并判断证据与作者结论之间的关系。理论或综述论文没有常规实验时，应改为分析证明、论证或材料覆盖情况。",
    "优点和局限都要说明论文内依据及其对理解和使用结论的影响。可复现性应检查代码、数据、参数、实现细节和计算资源是否充分。文献定位只能依据论文自己的相关工作部分，无法外部核实时必须说明。",
    "最后提炼读者真正应该带走的结论、适用条件和使用时需要注意的边界。",
  ].join("\n"),
  translation: "将内容准确翻译成简体中文，按完整段落和上下文组织自然译文，保留标题层级、专业术语、数学符号和引用编号。保持原文段落顺序，避免把连续正文拆成逐句列表。",
} as const;

const LEGACY_DEFAULT_AI_PROMPTS: Record<string, string> = {
  system: "你是一名严谨的论文阅读助手。请使用用户选择的语言回答，区分论文原文、你的解释和不确定信息，不要编造引用。",
  explain: AI_FEATURE_PROMPTS.explain,
  summary: "概括论文的研究问题、方法、主要结果、贡献和局限，严格基于提供的论文内容。",
};

export function personalizedPrompt(basePrompt: string, customPrompt?: string): string {
  const preference = customPrompt?.trim();
  return preference ? `${basePrompt}\n\n个性化要求：\n${preference}` : basePrompt;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  agentRuntime: "claude_code",
  agentAccess: { claude_code: "direct", codex_runtime: "direct" },
  agentPaths: {},
  agentThirdParty: {},
  provider: "ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
  apiKey: "",
  defaultModel: "qwen3:8b",
  defaultReasoningEffort: "auto",
  featureModels: {},
  availableModels: ["qwen3:8b", "deepseek-r1:8b", "llama3.2"],
  language: "zh-CN",
  semanticScholarApiKey: "",
  prompts: DEFAULT_AI_PROMPTS,
  appearance: {
    documentTheme: "original",
    reduceMotion: false,
  },
  desktopPet: DEFAULT_DESKTOP_PET_SETTINGS,
  desktopPetTts: DEFAULT_DESKTOP_PET_TTS_SETTINGS,
};

const SETTINGS_KEY = "whalepaper.ai-settings.v1";
const AI_FEATURE_IDS: AiFeature[] = ["review", "chat", "desktopPet", "explain", "translation", "highlights", "quiz"];

export function defaultAiModelConfig(settings: AiSettings): AiModelConfig {
  return {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.defaultModel,
    availableModels: settings.availableModels,
    reasoningEffort: settings.defaultReasoningEffort,
  };
}

const REASONING_EFFORTS: AiReasoningEffort[] = ["auto", "low", "medium", "high", "max"];

function normalizeReasoningEffort(value: unknown): AiReasoningEffort {
  return typeof value === "string" && REASONING_EFFORTS.includes(value as AiReasoningEffort)
    ? value as AiReasoningEffort
    : "auto";
}

export function supportedReasoningEfforts(config: Pick<AiModelConfig, "provider" | "model">): AiReasoningEffort[] {
  const model = config.model.toLowerCase();
  if ((config.provider === "openai" || config.provider === "custom") && /(?:^|[/_-])(?:gpt-5|o1|o3|o4)(?:$|[/_.-])/.test(model)) {
    return ["auto", "low", "medium", "high"];
  }
  if (config.provider === "anthropic" && /claude-(?:opus|sonnet)-4-(?:5|6|7|8|9)/.test(model)) {
    return ["auto", "low", "medium", "high", "max"];
  }
  if (config.provider === "gemini" && /gemini-3(?:$|[.-])/.test(model)) {
    return ["auto", "low", "medium", "high"];
  }
  return [];
}

export function resolvedReasoningEffort(config: AiModelConfig): Exclude<AiReasoningEffort, "auto"> | undefined {
  const effort = normalizeReasoningEffort(config.reasoningEffort);
  return effort !== "auto" && supportedReasoningEfforts(config).includes(effort) ? effort : undefined;
}

function normalizeModelConfig(value: unknown, fallback: AiModelConfig): AiModelConfig | undefined {
  if (typeof value === "string" && value.trim()) return { ...fallback, model: value.trim(), availableModels: Array.from(new Set([...fallback.availableModels, value.trim()])) };
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Partial<Record<keyof AiModelConfig, unknown>>;
  const provider = typeof source.provider === "string" && AI_PROVIDER_PRESETS.some((item) => item.id === source.provider)
    ? source.provider as AiProvider
    : inferProvider(typeof source.baseUrl === "string" ? source.baseUrl : "");
  const preset = providerPreset(provider);
  const model = typeof source.model === "string" ? source.model.trim() : "";
  if (!model) return undefined;
  const models = Array.isArray(source.availableModels)
    ? source.availableModels.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : [];
  return {
    provider,
    baseUrl: typeof source.baseUrl === "string" && source.baseUrl.trim() ? source.baseUrl.trim() : preset.baseUrl,
    apiKey: typeof source.apiKey === "string" ? source.apiKey : "",
    model,
    availableModels: Array.from(new Set([...(models.length ? models : preset.models), model])),
    reasoningEffort: normalizeReasoningEffort(source.reasoningEffort),
  };
}

export function loadAiSettings(): AiSettings {
  try {
    const stored = JSON.parse(readBrandedStorage(SETTINGS_KEY) || "{}") as Partial<AiSettings> & { model?: unknown };
    const provider = stored.provider || (stored.baseUrl ? inferProvider(stored.baseUrl) : DEFAULT_AI_SETTINGS.provider);
    const agentRuntime: AgentRuntimeId = stored.agentRuntime === "codex_runtime" ? "codex_runtime" : "claude_code";
    const rawAccess = stored.agentAccess && typeof stored.agentAccess === "object" ? stored.agentAccess : {};
    const agentAccess: Record<AgentRuntimeId, AgentAccessMode> = {
      claude_code: (rawAccess as Record<string, unknown>).claude_code === "thirdparty" ? "thirdparty" : "direct",
      codex_runtime: (rawAccess as Record<string, unknown>).codex_runtime === "thirdparty" ? "thirdparty" : "direct",
    };
    const rawAgentPaths = stored.agentPaths && typeof stored.agentPaths === "object" ? stored.agentPaths : {};
    const agentPaths = Object.fromEntries(([
      "claude_code", "codex_runtime",
    ] as AgentRuntimeId[]).flatMap((runtime) => {
      const value = (rawAgentPaths as Record<string, unknown>)[runtime];
      return typeof value === "string" && value.trim() ? [[runtime, value.trim()]] : [];
    })) as Partial<Record<AgentRuntimeId, string>>;
    const rawThirdParty = stored.agentThirdParty && typeof stored.agentThirdParty === "object" ? stored.agentThirdParty : {};
    const agentThirdParty = Object.fromEntries(([
      "claude_code", "codex_runtime",
    ] as AgentRuntimeId[]).flatMap((runtime) => {
      const value = (rawThirdParty as Record<string, unknown>)[runtime];
      if (!value || typeof value !== "object") return [];
      const row = value as Record<string, unknown>;
      return [[runtime, {
        baseUrl: typeof row.baseUrl === "string" ? row.baseUrl : "",
        apiKey: typeof row.apiKey === "string" ? row.apiKey : "",
        model: typeof row.model === "string" ? row.model : "",
        models: Array.isArray(row.models)
          ? row.models.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
          : [],
      }]];
    }));
    const storedPrompts = (stored.prompts || {}) as Record<string, unknown>;
    const prompts = Object.fromEntries(
      (Object.keys(DEFAULT_AI_PROMPTS) as Array<keyof AiPromptSettings>).map((key) => {
        const rawValue = key === "review" ? storedPrompts.review ?? storedPrompts.summary : storedPrompts[key];
        const value = typeof rawValue === "string" ? rawValue : "";
        const legacyKey = key === "review" ? "summary" : key;
        return [key, value === LEGACY_DEFAULT_AI_PROMPTS[legacyKey] ? "" : value];
      }),
    ) as AiPromptSettings;
    const defaultModel = typeof stored.defaultModel === "string" && stored.defaultModel.trim()
      ? stored.defaultModel.trim()
      : typeof stored.model === "string" && stored.model.trim()
        ? stored.model.trim()
        : DEFAULT_AI_SETTINGS.defaultModel;
    const storedModels = Array.isArray(stored.availableModels)
      ? stored.availableModels.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
      : [];
    const availableModels = Array.from(new Set([
      ...(storedModels.length ? storedModels : providerPreset(provider).models),
      defaultModel,
    ].filter(Boolean)));
    const defaultReasoningEffort = normalizeReasoningEffort(stored.defaultReasoningEffort);
    const defaultConfig: AiModelConfig = { provider, baseUrl: stored.baseUrl || providerPreset(provider).baseUrl, apiKey: stored.apiKey || "", model: defaultModel, availableModels, reasoningEffort: defaultReasoningEffort };
    const storedFeatureModels: Partial<Record<AiFeature, unknown>> = stored.featureModels && typeof stored.featureModels === "object" ? stored.featureModels : {};
    const featureModels = Object.fromEntries(AI_FEATURE_IDS.flatMap((feature) => {
      const config = normalizeModelConfig(storedFeatureModels[feature], defaultConfig);
      return config ? [[feature, config]] : [];
    })) as Partial<Record<AiFeature, AiModelConfig>>;
    const storedSettings = { ...stored };
    delete storedSettings.model;
    return {
      ...DEFAULT_AI_SETTINGS,
      ...storedSettings,
      agentRuntime,
      agentAccess,
      agentPaths,
      agentThirdParty,
      provider,
      defaultModel,
      defaultReasoningEffort,
      featureModels,
      availableModels,
      prompts,
      appearance: { ...DEFAULT_AI_SETTINGS.appearance, ...stored.appearance },
      desktopPet: normalizeDesktopPetSettings(stored.desktopPet),
      desktopPetTts: normalizeDesktopPetTtsSettings(stored.desktopPetTts),
    };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

export function resolveAiModel(settings: AiSettings, feature?: AiFeature): string {
  return resolveAiModelConfig(settings, feature).model;
}

export function resolveAiModelConfig(settings: AiSettings, feature?: AiFeature): AiModelConfig {
  const featureConfig = feature && settings.featureModels[feature];
  // A feature override from another provider must not survive a switch of the
  // default service. Otherwise changing to DeepSeek still sends some features
  // to a stale OpenAI-compatible endpoint. Same-provider overrides remain valid.
  const sameService = featureConfig
    && featureConfig.provider === settings.provider
    && featureConfig.baseUrl.trim().replace(/\/+$/, "") === settings.baseUrl.trim().replace(/\/+$/, "");
  if (sameService) return featureConfig;
  return defaultAiModelConfig(settings);
}

export function saveAiSettings(settings: AiSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function providerPreset(provider: AiProvider): AiProviderPreset {
  return AI_PROVIDER_PRESETS.find((item) => item.id === provider) || AI_PROVIDER_PRESETS[AI_PROVIDER_PRESETS.length - 1];
}

function inferProvider(baseUrl?: string): AiProvider {
  const value = (baseUrl || "").toLocaleLowerCase();
  if (value.includes("11434")) return "ollama";
  if (value.includes("1234")) return "lmstudio";
  if (value.includes("anthropic")) return "anthropic";
  if (value.includes("googleapis")) return "gemini";
  if (value.includes("deepseek")) return "deepseek";
  if (value.includes("moonshot")) return "moonshot";
  if (value.includes("dashscope")) return "qwen";
  if (value.includes("openai")) return "openai";
  return "custom";
}

type DesktopHttpResponse = { status: number; body: string };

function networkRequestError(url: string, error: unknown): Error {
  let target = "模型服务";
  try {
    const parsed = new URL(url);
    target = `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch { /* keep the generic target */ }
  const local = /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(target);
  return new Error(local
    ? `无法连接本地模型服务（${target}）。请先启动 Ollama / LM Studio，并确认已安装所选模型。`
    : `无法连接模型服务（${target}）。请检查网络、API 地址和浏览器跨域设置。${error instanceof Error && error.message !== "Failed to fetch" ? ` ${error.message}` : ""}`);
}

function httpRequestError(status: number, body: string, url: string): Error {
  const summary = body.slice(0, 320);
  if (status === 401 || status === 403) return new Error("大模型鉴权失败，请在模型设置中检查 API Key。");
  if (status === 429) return new Error("大模型服务当前请求过多或额度不足，请检查账户额度后重试。");
  if (status === 404 && /model.*(?:not found|does not exist)|(?:not found|does not exist).*model/i.test(body)) {
    return new Error("当前选择的大模型未安装或不存在，请在模型设置中重新选择。");
  }
  let target = "";
  try { target = new URL(url).host; } catch { /* optional diagnostic */ }
  return new Error(`大模型请求失败（${status}）${target ? ` · ${target}` : ""}：${summary || "服务未返回详细信息"}`);
}

export function assertAiModelConfigured(settings: AiSettings, feature?: AiFeature): AiModelConfig {
  const config = resolveAiModelConfig(settings, feature);
  if (!config.baseUrl.trim() || !config.model.trim()) throw new Error("请先在模型设置中配置可用的大模型。");
  const preset = providerPreset(config.provider);
  if (preset.apiKeyRequired && !config.apiKey.trim()) throw new Error(`请先在模型设置中填写 ${preset.label} API Key。`);
  return config;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let status: number;
  let responseBody: string;
  if (isTauri()) {
    let response: DesktopHttpResponse;
    try {
      response = await invoke<DesktopHttpResponse>("ai_http_request", { request: { url, headers, body } });
    } catch (error) {
      throw networkRequestError(url, error);
    }
    status = response.status;
    responseBody = response.body;
  } else {
    let response: Response;
    try {
      response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    } catch (error) {
      throw networkRequestError(url, error);
    }
    status = response.status;
    responseBody = await response.text();
  }
  if (status < 200 || status >= 300) throw httpRequestError(status, responseBody, url);
  try {
    return JSON.parse(responseBody) as unknown;
  } catch {
    throw new Error("模型返回了无法解析的数据。");
  }
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  let status: number;
  let responseBody: string;
  if (isTauri()) {
    let response: DesktopHttpResponse;
    try {
      response = await invoke<DesktopHttpResponse>("ai_http_request", { request: { url, headers, method: "GET" } });
    } catch (error) {
      throw networkRequestError(url, error);
    }
    status = response.status;
    responseBody = response.body;
  } else {
    let response: Response;
    try {
      response = await fetch(url, { method: "GET", headers });
    } catch (error) {
      throw networkRequestError(url, error);
    }
    status = response.status;
    responseBody = await response.text();
  }
  if (status < 200 || status >= 300) throw httpRequestError(status, responseBody, url);
  try {
    return JSON.parse(responseBody) as unknown;
  } catch {
    throw new Error("模型目录接口返回了无法解析的数据。");
  }
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function uniqueModelIds(values: unknown[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

export async function fetchAvailableModels(settings: Pick<AiModelConfig, "provider" | "baseUrl" | "apiKey">): Promise<string[]> {
  const baseUrl = settings.baseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("请先填写 API 地址。");
  // Historical settings may label a local endpoint as "custom". The URL is
  // authoritative for discovery because Ollama does not expose /v1/models.
  const discoveryProvider = baseUrl.includes("11434") ? "ollama" : settings.provider;

  let payload: unknown;
  if (discoveryProvider === "ollama") {
    const ollamaRoot = baseUrl.replace(/\/v1$/i, "");
    payload = await getJson(`${ollamaRoot}/api/tags`, {});
    const items = (payload as { models?: unknown }).models;
    const models = uniqueModelIds(Array.isArray(items) ? items.map((item) => (
      item && typeof item === "object" && "name" in item ? (item as { name?: unknown }).name : ""
    )) : []);
    if (!models.length) throw new Error("服务连接成功，但未返回可用模型。");
    return models;
  }

  if (discoveryProvider === "gemini") {
    if (!settings.apiKey.trim()) throw new Error("请先填写 API Key。");
    payload = await getJson(`${baseUrl}/models`, { "x-goog-api-key": settings.apiKey.trim() });
    const items = (payload as { models?: unknown }).models;
    const models = uniqueModelIds(Array.isArray(items) ? items.flatMap((item) => {
      if (!item || typeof item !== "object" || !("name" in item)) return [];
      const methods = (item as { supportedGenerationMethods?: unknown }).supportedGenerationMethods;
      if (Array.isArray(methods) && !methods.includes("generateContent")) return [];
      return [String((item as { name: unknown }).name).replace(/^models\//, "")];
    }) : []);
    if (!models.length) throw new Error("服务连接成功，但未返回可用的生成模型。");
    return models;
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (discoveryProvider === "anthropic") {
    if (!settings.apiKey.trim()) throw new Error("请先填写 API Key。");
    headers["x-api-key"] = settings.apiKey.trim();
    headers["anthropic-version"] = "2023-06-01";
  } else if (settings.apiKey.trim()) {
    headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
  }
  payload = await getJson(`${baseUrl}/models`, headers);
  const data = (payload as { data?: unknown }).data;
  const directModels = (payload as { models?: unknown }).models;
  const items = Array.isArray(data) ? data : Array.isArray(directModels) ? directModels : [];
  const models = uniqueModelIds(items.map((item) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    if ("id" in item) return (item as { id?: unknown }).id;
    if ("name" in item) return (item as { name?: unknown }).name;
    return "";
  }));
  if (!models.length) throw new Error("服务连接成功，但未返回可用模型。");
  return models;
}

const localModelCache = new Map<string, { expiresAt: number; models: string[] }>();

async function resolveReadyAiModel(settings: AiSettings, feature?: AiFeature): Promise<AiModelConfig> {
  const config = assertAiModelConfigured(settings, feature);
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/i.test(config.baseUrl)) return config;
  const cacheKey = `${config.provider}:${config.baseUrl}:${config.apiKey}`;
  const cached = localModelCache.get(cacheKey);
  let models = cached && cached.expiresAt > Date.now() ? cached.models : null;
  if (!models) {
    try {
      models = await fetchAvailableModels(config);
      localModelCache.set(cacheKey, { models, expiresAt: Date.now() + 15_000 });
    } catch {
      throw new Error("尚未配置可用的本地大模型。请先启动本地模型服务、安装模型，再到模型设置中选择它。");
    }
  }
  const selected = config.model.toLocaleLowerCase();
  const available = models.some((model) => {
    const candidate = model.toLocaleLowerCase();
    return candidate === selected || candidate.split(":")[0] === selected.split(":")[0];
  });
  if (!available) throw new Error(`当前选择的本地大模型“${config.model}”未安装，请在模型设置中重新选择。`);
  return config;
}

function normalizeAssistantContext(context: AssistantContext): { session: string; turn: string } {
  return typeof context === "string"
    ? { session: context, turn: "" }
    : { session: context.session, turn: context.turn || "" };
}

function baseSystemContext(settings: AiSettings, feature?: AiFeature): string {
  const language = settings.language === "zh-CN" ? "请使用简体中文回答。" : "Answer in English.";
  const base = [personalizedPrompt(BASE_SYSTEM_PROMPT, settings.prompts.system), language].join("\n\n");
  return feature === "chat" ? personalizedPrompt(base, settings.prompts.chat) : base;
}

function contextualizeMessages(
  messages: ChatMessage[],
  context: { session: string; turn: string },
): ChatMessage[] {
  const contextualized = [...messages];
  if (context.turn) {
    contextualized.splice(Math.max(0, contextualized.length - 1), 0, {
      id: "turn-source-context",
      role: "user",
      content: `[本轮新增材料]\n${context.turn}`,
    });
  }
  if (context.session) {
    contextualized.unshift({
      id: "paper-source-context",
      role: "user",
      content: `[论文原文]\n${context.session}`,
    });
  }
  return contextualized;
}

function responseText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    const item = part as { text?: unknown };
    if (typeof item.text === "string") return item.text;
    if (item.text && typeof item.text === "object" && "value" in item.text) {
      const nested = (item.text as { value?: unknown }).value;
      return typeof nested === "string" ? nested : "";
    }
    return "";
  }).join("").trim();
}

function nonReasoningFallbackModel(config: AiModelConfig, feature?: AiFeature): string | undefined {
  if (!/reasoner|reasoning|thinking/i.test(config.model)) return undefined;
  if (config.provider === "deepseek" || /deepseek\.com/i.test(config.baseUrl)) {
    return config.availableModels.find((model) => /flash|pro/i.test(model) && !/reasoner|reasoning|thinking/i.test(model)) || "deepseek-flash";
  }
  // Translation and other short-form features should not fall back to a
  // model that spends the whole output budget on hidden reasoning.
  if (feature === "translation" && config.provider === "openai") return "gpt-4.1-mini";
  return undefined;
}

function translationRetryModel(config: AiModelConfig, feature?: AiFeature): string | undefined {
  if (feature !== "translation" || !(/deepseek\.com/i.test(config.baseUrl) || config.provider === "deepseek")) return undefined;
  return config.availableModels.find((model) => /flash/i.test(model) && model !== config.model)
    || config.availableModels.find((model) => /pro/i.test(model) && model !== config.model)
    || "deepseek-flash";
}

async function requestText(
  settings: AiSettings,
  messages: ChatMessage[],
  context: AssistantContext,
  feature?: AiFeature,
  options: AiRequestOptions = {},
): Promise<string> {
  const normalizedContext = normalizeAssistantContext(context);
  const system = baseSystemContext(settings, feature);
  const contextualizedMessages = contextualizeMessages(messages, normalizedContext);
  const config = await resolveReadyAiModel(settings, feature);
  const fallbackModel = nonReasoningFallbackModel(config, feature);
  const retryModel = fallbackModel || translationRetryModel(config, feature);
  const requestModel = options.modelOverride || (feature === "translation" && fallbackModel ? fallbackModel : config.model);
  const reasoningEffort = options.disableReasoning || requestModel !== config.model ? undefined : resolvedReasoningEffort(config);
  const maxOutputTokens = options.omitMaxOutputTokens ? undefined : Math.max(256, Math.min(8192, options.maxOutputTokens || 2048));
  const temperature = Math.max(0, Math.min(1, options.temperature ?? 0.25));
  const retryWithoutReasoning = () => requestText(settings, messages, context, feature, {
    ...options,
    disableReasoning: true,
    modelOverride: retryModel || options.modelOverride,
    ...(options.omitMaxOutputTokens ? {} : { maxOutputTokens: Math.min(8192, Math.max((maxOutputTokens || 2048) * 2, 4096)) }),
  });
  if (config.provider === "anthropic") {
    const sessionMessageCount = normalizedContext.session ? 1 : 0;
    const cachedPrefixBoundary = options.cachePrefixMessages
      ? sessionMessageCount + options.cachePrefixMessages
      : sessionMessageCount;
    const payload = await postJson(endpoint(config.baseUrl, "/messages"), {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    }, {
      model: requestModel,
      ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
      temperature,
      ...(reasoningEffort ? { output_config: { effort: reasoningEffort } } : {}),
      system,
      messages: contextualizedMessages.map(({ role, content }, index) => ({
        role,
        content: [{
          type: "text",
          text: content,
          ...(options.cacheAffinityKey && cachedPrefixBoundary === index + 1
            ? { cache_control: { type: "ephemeral" } }
            : {}),
        }],
      })),
    }) as { content?: Array<{ type?: string; text?: string }> };
    const content = payload.content?.find((item) => item.type === "text")?.text;
    if (!content && !options.disableReasoning) return retryWithoutReasoning();
    if (!content) throw new Error("模型没有返回文本内容。");
    return content;
  }

  if (config.provider === "gemini") {
    const url = `${endpoint(config.baseUrl, `/models/${encodeURIComponent(requestModel)}:generateContent`)}?key=${encodeURIComponent(config.apiKey)}`;
    const payload = await postJson(url, { "Content-Type": "application/json" }, {
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: {
        temperature,
        ...(maxOutputTokens ? { maxOutputTokens } : {}),
        ...(reasoningEffort ? { thinkingConfig: { thinkingLevel: reasoningEffort.toUpperCase() } } : {}),
      },
      contents: contextualizedMessages.map(({ role, content }) => ({ role: role === "assistant" ? "model" : "user", parts: [{ text: content }] })),
    }) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const content = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
    if (!content && !options.disableReasoning) return retryWithoutReasoning();
    if (!content) throw new Error("模型没有返回文本内容。");
    return content;
  }

  const payload = await postJson(endpoint(config.baseUrl, "/chat/completions"), {
    "Content-Type": "application/json",
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  }, {
    model: requestModel,
    temperature,
    ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort === "max" ? "high" : reasoningEffort } : {}),
    ...((options.disableReasoning || (feature === "translation" && /deepseek-r1|reasoner|thinking/i.test(config.model))) && config.provider === "ollama" ? { think: false } : {}),
    ...(config.provider === "openai" && options.cacheAffinityKey
      ? { prompt_cache_key: options.cacheAffinityKey }
      : {}),
    ...(config.provider === "deepseek" && options.jsonResponse
      ? { response_format: { type: "json_object" } }
      : {}),
    messages: [
      { role: "system", content: system },
      ...contextualizedMessages.map(({ role, content }) => ({ role, content })),
    ],
  }) as {
    choices?: Array<{
      finish_reason?: unknown;
      text?: unknown;
      message?: { content?: unknown; reasoning_content?: unknown };
    }>;
  };
  const choice = payload.choices?.[0];
  const content = responseText(choice?.message?.content) || responseText(choice?.text);
  if (content && choice?.finish_reason === "length") {
    if (!options.disableReasoning) return retryWithoutReasoning();
    if (options.jsonResponse) throw new Error("模型输出达到长度上限，结构化结果不完整。请减少检查范围或更换上下文更大的模型。");
  }
  if (content) return content;

  const reasoning = responseText(choice?.message?.reasoning_content);
  if (options.jsonResponse && reasoning && /[\[{]/.test(reasoning)) return reasoning;
  if (choice?.finish_reason === "length") {
    if (!options.disableReasoning) return retryWithoutReasoning();
    throw new Error("模型推理达到输出上限，尚未生成最终结果。请重试或选择非推理模型。");
  }
  if (reasoning) {
    if (!options.disableReasoning) return retryWithoutReasoning();
    throw new Error("模型只返回了推理过程，没有生成最终结果。请重试或选择非推理模型。");
  }
  if (!choice) throw new Error("模型响应中没有可用的候选结果。");
  throw new Error("模型没有返回文本内容。");
}

export async function askAssistant(
  settings: AiSettings,
  messages: ChatMessage[],
  context: AssistantContext,
  feature: AiFeature,
  options?: AiRequestOptions,
): Promise<string> {
  return requestText(settings, messages, context, feature, options);
}

export async function askAssistantJson<T>(
  settings: AiSettings,
  prompt: string,
  context: AssistantContext,
  feature: AiFeature,
  options?: AiRequestOptions,
): Promise<T> {
  const response = await requestText(
    settings,
    [{
      id: crypto.randomUUID(),
      role: "user",
      content: `${prompt}\n\nJSON serialization requirements:\n- Return exactly one JSON object or array.\n- Escape every backslash inside JSON strings, including all LaTeX commands (for example, write \\\\alpha rather than \\alpha).\n- Escape embedded quotes and line breaks.\n- Do not use Markdown fences, comments, trailing commas, NaN, or Infinity.`,
    }],
    context,
    feature,
    { ...options, jsonResponse: true },
  );
  try {
    return parseStructuredJson<T>(response);
  } catch (error) {
    if (!(error instanceof StructuredJsonParseError) || error.likelyTruncated) throw error;
    const reformatted = await requestText(
      settings,
      [{
        id: crypto.randomUUID(),
        role: "user",
        content: `Convert the following malformed model output into exactly one valid JSON object or array. Preserve all values and escape LaTeX backslashes, quotes, and line breaks correctly. Return JSON only.\n\n${response}`,
      }],
      "",
      feature,
      { ...options, jsonResponse: true, temperature: 0, maxOutputTokens: options?.maxOutputTokens || 8192 },
    );
    return parseStructuredJson<T>(reformatted);
  }
}

export async function askAssistantWithImage(
  settings: AiSettings,
  prompt: string,
  imageDataUrl: string,
  pageContext: string,
  feature: AiFeature,
): Promise<string> {
  const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("无法读取所选图像。");
  const [, mediaType, data] = match;
  const system = baseSystemContext(settings, feature);
  const sourceContext = pageContext.slice(0, 8000);
  const config = await resolveReadyAiModel(settings, feature);
  const reasoningEffort = resolvedReasoningEffort(config);

  if (config.provider === "anthropic") {
    const payload = await postJson(endpoint(config.baseUrl, "/messages"), {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    }, { model: config.model, max_tokens: 2048, system, ...(reasoningEffort ? { output_config: { effort: reasoningEffort } } : {}), messages: [
      ...(sourceContext ? [{ role: "user", content: [{ type: "text", text: `[当前页原文]\n${sourceContext}` }] }] : []),
      { role: "user", content: [
        { type: "text", text: prompt },
        { type: "image", source: { type: "base64", media_type: mediaType, data } },
      ] },
    ] }) as { content?: Array<{ type?: string; text?: string }> };
    const content = payload.content?.find((item) => item.type === "text")?.text;
    if (!content) throw new Error("模型没有返回图像解释。");
    return content;
  }

  if (config.provider === "gemini") {
    const url = `${endpoint(config.baseUrl, `/models/${encodeURIComponent(config.model)}:generateContent`)}?key=${encodeURIComponent(config.apiKey)}`;
    const payload = await postJson(url, { "Content-Type": "application/json" }, {
      systemInstruction: { parts: [{ text: system }] },
      ...(reasoningEffort ? { generationConfig: { thinkingConfig: { thinkingLevel: reasoningEffort.toUpperCase() } } } : {}),
      contents: [
        ...(sourceContext ? [{ role: "user", parts: [{ text: `[当前页原文]\n${sourceContext}` }] }] : []),
        { role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: mediaType, data } }] },
      ],
    }) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const content = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
    if (!content) throw new Error("模型没有返回图像解释。");
    return content;
  }

  const payload = await postJson(endpoint(config.baseUrl, "/chat/completions"), {
    "Content-Type": "application/json",
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  }, { model: config.model, temperature: 0.2, ...(reasoningEffort ? { reasoning_effort: reasoningEffort === "max" ? "high" : reasoningEffort } : {}), messages: [
    { role: "system", content: system },
    ...(sourceContext ? [{ role: "user", content: `[当前页原文]\n${sourceContext}` }] : []),
    { role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageDataUrl } }] },
  ] }) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("模型没有返回图像解释。");
  return content;
}

export async function testAiConnection(settings: AiSettings): Promise<string> {
  const startedAt = performance.now();
  const answer = await requestText(settings, [{ id: "connection-test", role: "user", content: "只回复 OK" }], "");
  return `${Math.round(performance.now() - startedAt)} ms · ${answer.trim().slice(0, 40)}`;
}
