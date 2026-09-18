import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AiSettings, DesktopPetTtsSettings } from "../types";

type BinaryHttpResponse = { status: number; body: string; content_type?: string; contentType?: string };
type TtsConfig = DesktopPetTtsSettings & { fallbackBaseUrl?: string; fallbackApiKey?: string };

export async function fetchTtsModels(config: Pick<DesktopPetTtsSettings, "provider" | "apiBaseUrl" | "apiKey">): Promise<string[]> {
  if (config.provider !== "openai-tts") return [];
  const baseUrl = config.apiBaseUrl.trim().replace(/\/$/, "");
  if (!baseUrl) throw new Error("请先填写 TTS Base URL。");
  const headers: Record<string, string> = {};
  if (config.apiKey.trim()) headers.Authorization = `Bearer ${config.apiKey.trim()}`;
  let status: number;
  let body: string;
  if (isTauri()) {
    const response = await invoke<{ status: number; body: string }>("ai_http_request", { request: { url: `${baseUrl}/models`, method: "GET", headers } });
    status = response.status;
    body = response.body;
  } else {
    const response = await fetch(`${baseUrl}/models`, { headers });
    status = response.status;
    body = await response.text();
  }
  if (status < 200 || status >= 300) throw new Error(`获取 TTS 模型失败（${status}）`);
  const payload = JSON.parse(body) as { data?: Array<{ id?: unknown }>; models?: Array<{ id?: unknown } | string> };
  const values = Array.isArray(payload.data) ? payload.data.map((item) => item.id) : Array.isArray(payload.models) ? payload.models.map((item) => typeof item === "string" ? item : item.id) : [];
  return Array.from(new Set(values.map((item) => String(item || "").trim()).filter(Boolean)));
}

let generation = 0;
let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl = "";
let currentResolve: (() => void) | null = null;
let queue: string[] = [];
let playing = false;
let stateListener: ((value: boolean) => void) | null = null;

function notify(value: boolean) { playing = value; stateListener?.(value); }
export function setTtsStateListener(listener: ((value: boolean) => void) | null) { stateListener = listener; }

function splitSentences(text: string, enabled: boolean, maximum: number): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  if (!enabled) return [normalized];
  const pieces = normalized.split(/(?<=[。！？!?；;：:，,、\n])\s*/).filter(Boolean);
  const result: string[] = [];
  for (const piece of pieces) {
    if (piece.length <= maximum) result.push(piece);
    else for (let index = 0; index < piece.length; index += maximum) result.push(piece.slice(index, index + maximum));
  }
  return result;
}

function playBrowser(text: string, config: TtsConfig, token: number): Promise<void> {
  return new Promise((resolve) => {
    if (token !== generation || typeof speechSynthesis === "undefined") return resolve();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = config.rate;
    utterance.volume = config.volume;
    utterance.lang = /[\u3400-\u9fff]/.test(text) ? "zh-CN" : "en-US";
    if (config.voice) {
      const voice = speechSynthesis.getVoices().find((item) => item.name === config.voice || item.voiceURI === config.voice);
      if (voice) utterance.voice = voice;
    } else {
      const preferred = speechSynthesis.getVoices().find((item) => item.lang.toLowerCase().startsWith(utterance.lang.toLowerCase().slice(0, 2)));
      if (preferred) utterance.voice = preferred;
    }
    const finish = () => { currentResolve = null; resolve(); };
    utterance.onend = finish;
    utterance.onerror = finish;
    currentResolve = finish;
    speechSynthesis.speak(utterance);
  });
}

function hexToBytes(value: string): Uint8Array {
  const normalized = value.trim();
  const bytes = new Uint8Array(Math.floor(normalized.length / 2));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

async function requestAudio(text: string, config: TtsConfig): Promise<string> {
  const providerDefaults: Record<string, string> = { "openai-tts": "https://api.openai.com/v1", elevenlabs: "https://api.elevenlabs.io/v1", "minimax-tts": "https://api.minimax.io/v1", "fish-audio": "https://api.fish.audio" };
  const baseUrl = (config.apiBaseUrl || providerDefaults[config.provider] || config.fallbackBaseUrl || "").trim().replace(/\/$/, "");
  if (!baseUrl) throw new Error("请在桌宠设置中填写 TTS API 地址。");
  const providerConfig = config.extraConfigs[config.provider] || {};
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = (config.apiKey || config.fallbackApiKey || "").trim();
  let url = `${baseUrl}/audio/speech`;
  let payload: Record<string, unknown> = { model: config.model, voice: config.voice || "alloy", input: text, response_format: String(providerConfig.response_format || "mp3") };
  if (config.provider === "elevenlabs") {
    url = `${baseUrl}/text-to-speech/${encodeURIComponent(String(providerConfig.voice_id || config.voice || "EXAVITQu4vr4xnSDxMaL"))}?output_format=${encodeURIComponent(String(providerConfig.output_format || "mp3_44100_128"))}`;
    payload = { text, model_id: String(providerConfig.model_id || config.model || "eleven_multilingual_v2"), voice_settings: { stability: Number(providerConfig.stability ?? 0.5), similarity_boost: Number(providerConfig.similarity_boost ?? 0.75) } };
    headers["xi-api-key"] = apiKey;
    headers.Accept = "audio/mpeg";
  } else if (config.provider === "minimax-tts") {
    url = `${baseUrl}/t2a_v2?GroupId=${encodeURIComponent(String(providerConfig.group_id || ""))}`;
    payload = { model: String(providerConfig.model || config.model || "speech-02-hd"), text, stream: false, voice_setting: { voice_id: String(providerConfig.voice_id || config.voice || "female-shaonv"), speed: Number(providerConfig.speed ?? config.rate), vol: Number(providerConfig.vol ?? config.volume), pitch: Number(providerConfig.pitch ?? 0) }, audio_setting: { sample_rate: Number(providerConfig.sample_rate || 32000), bitrate: Number(providerConfig.bitrate || 128000), format: String(providerConfig.audio_format || "mp3"), channel: 1 } };
    headers.Authorization = `Bearer ${apiKey}`;
  } else if (config.provider === "fish-audio") {
    url = baseUrl.endsWith("/v1/tts") ? baseUrl : `${baseUrl}/v1/tts`;
    payload = { text, format: String(providerConfig.audio_format || "mp3"), ...(providerConfig.mp3_bitrate ? { mp3_bitrate: Number(providerConfig.mp3_bitrate) } : {}), ...(providerConfig.reference_id ? { reference_id: String(providerConfig.reference_id) } : {}), ...(providerConfig.latency ? { latency: String(providerConfig.latency) } : {}) };
    headers.Authorization = `Bearer ${apiKey}`;
    headers.Accept = "audio/mpeg";
    headers.model = String(providerConfig.model || config.model || "s2-pro");
  } else {
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  }
  if (config.provider === "minimax-tts" && !providerConfig.group_id) throw new Error("MiniMax TTS 需要 Group ID。");
  let bytes: Uint8Array;
  let contentType = "audio/mpeg";
  if (isTauri()) {
    const response = await invoke<BinaryHttpResponse>("ai_http_binary_request", { request: { url, headers, body: payload } });
    if (response.status < 200 || response.status >= 300) throw new Error(`TTS 请求失败（${response.status}）`);
    const encoded = response.body;
    bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    contentType = response.contentType || response.content_type || contentType;
  } else {
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`TTS 请求失败（${response.status}）`);
    contentType = response.headers.get("content-type") || contentType;
    if (config.provider === "minimax-tts") {
      const data = await response.json() as { data?: { audio?: string } };
      if (!data.data?.audio) throw new Error("MiniMax TTS 没有返回音频。");
      bytes = hexToBytes(data.data.audio);
    } else bytes = new Uint8Array(await response.arrayBuffer());
  }
  const audioBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return URL.createObjectURL(new Blob([audioBuffer], { type: contentType }));
}

function playAudioUrl(url: string, config: TtsConfig, token: number): Promise<void> {
  return new Promise((resolve) => {
    if (token !== generation) return resolve();
    const audio = new Audio(url);
    currentAudio = audio;
    currentObjectUrl = url;
    audio.volume = config.volume;
    const finish = () => {
      if (currentAudio === audio) currentAudio = null;
      if (currentObjectUrl === url) { URL.revokeObjectURL(url); currentObjectUrl = ""; }
      currentResolve = null;
      resolve();
    };
    audio.onended = finish;
    audio.onerror = finish;
    currentResolve = finish;
    void audio.play().catch(finish);
  });
}

export async function speakDesktopPet(text: string, settings: TtsConfig, aiSettings?: AiSettings): Promise<void> {
  stopDesktopPetTts();
  if (!settings.enabled) return;
  const token = generation;
  queue = splitSentences(text, settings.splitEnabled, settings.maxSentenceLength);
  notify(queue.length > 0);
  try {
    while (queue.length && token === generation) {
      const segment = queue.shift()!;
      if (settings.provider !== "browser" && settings.provider !== "edge-tts") {
        const url = await requestAudio(segment, { ...settings, fallbackBaseUrl: aiSettings?.baseUrl, fallbackApiKey: aiSettings?.apiKey });
        await playAudioUrl(url, settings, token);
      } else {
        const providerConfig = settings.extraConfigs[settings.provider] || {};
        const edgeRate = String(providerConfig.rate || "").match(/^([+-]?[\d.]+)%$/);
        const playbackSettings = {
          ...settings,
          voice: String(providerConfig.voice || settings.voice || ""),
          rate: edgeRate ? Math.min(2, Math.max(0.5, 1 + Number(edgeRate[1]) / 100)) : settings.rate,
        };
        await playBrowser(segment, playbackSettings, token);
      }
    }
  } finally {
    if (token === generation) { queue = []; notify(false); }
  }
}

export function stopDesktopPetTts() {
  generation += 1;
  queue = [];
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  currentAudio?.pause();
  currentAudio = null;
  currentResolve?.();
  currentResolve = null;
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = "";
  notify(false);
}

export function isDesktopPetTtsPlaying() { return playing; }
