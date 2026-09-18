import type { DesktopPetSettings, DesktopPetSkin, DesktopPetTtsSettings, DesktopPetTtsProvider, DesktopPetWindowSize } from "../types";

export const DEFAULT_DESKTOP_PET_SETTINGS: DesktopPetSettings = {
  enabled: true,
  alwaysOnTop: true,
  recommendationAlerts: true,
  avatarScale: 1,
  skin: "datawhale-spirit",
  windowSize: "compact",
  openTarget: "discovery",
  customSpriteDataUrl: "",
  customSpriteName: "",
};

export const DEFAULT_DESKTOP_PET_TTS_SETTINGS: DesktopPetTtsSettings = {
  enabled: true,
  autoPlay: true,
  provider: "edge-tts",
  voice: "",
  rate: 1,
  volume: 1,
  splitEnabled: true,
  maxSentenceLength: 15,
  apiBaseUrl: "",
  apiKey: "",
  model: "gpt-4o-mini-tts",
  extraConfigs: {},
};

export const DESKTOP_PET_WINDOW_SIZES: Record<DesktopPetWindowSize, { width: number; height: number }> = {
  // Keep the floating window close to the actual sprite footprint. The chat
  // bubble/composer scale with this base size instead of covering the reader.
  compact: { width: 252, height: 318 },
  standard: { width: 286, height: 362 },
  spacious: { width: 324, height: 410 },
};

export type DesktopPetContext = {
  documentId: string;
  title: string;
  page: number;
  pageText: string;
  selectedText: string;
};

const WINDOW_SIZE_IDS: DesktopPetWindowSize[] = ["compact", "standard", "spacious"];
const SKIN_IDS: DesktopPetSkin[] = ["datawhale-spirit", "cat-spirit", "panda-spirit", "robot-assistant", "custom"];
const OPEN_TARGET_IDS: DesktopPetSettings["openTarget"][] = ["reader", "writer", "discovery"];

export function normalizeDesktopPetSettings(value: unknown): DesktopPetSettings {
  const source = value && typeof value === "object" ? value as Partial<DesktopPetSettings> : {};
  const avatarScale = typeof source.avatarScale === "number" && Number.isFinite(source.avatarScale)
    ? Math.min(1.15, Math.max(0.75, source.avatarScale))
    : DEFAULT_DESKTOP_PET_SETTINGS.avatarScale;
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_DESKTOP_PET_SETTINGS.enabled,
    alwaysOnTop: typeof source.alwaysOnTop === "boolean" ? source.alwaysOnTop : DEFAULT_DESKTOP_PET_SETTINGS.alwaysOnTop,
    recommendationAlerts: typeof source.recommendationAlerts === "boolean" ? source.recommendationAlerts : DEFAULT_DESKTOP_PET_SETTINGS.recommendationAlerts,
    avatarScale,
    skin: SKIN_IDS.includes(source.skin as DesktopPetSkin)
      ? source.skin as DesktopPetSkin
      : source.customSpriteDataUrl ? "custom" : DEFAULT_DESKTOP_PET_SETTINGS.skin,
    windowSize: WINDOW_SIZE_IDS.includes(source.windowSize as DesktopPetWindowSize)
      ? source.windowSize as DesktopPetWindowSize
      : DEFAULT_DESKTOP_PET_SETTINGS.windowSize,
    openTarget: OPEN_TARGET_IDS.includes(source.openTarget as DesktopPetSettings["openTarget"])
      ? source.openTarget as DesktopPetSettings["openTarget"]
      : DEFAULT_DESKTOP_PET_SETTINGS.openTarget,
    customSpriteDataUrl: typeof source.customSpriteDataUrl === "string"
      && source.customSpriteDataUrl.startsWith("data:image/")
      && source.customSpriteDataUrl.length <= 4_200_000
      ? source.customSpriteDataUrl
      : "",
    customSpriteName: typeof source.customSpriteName === "string" ? source.customSpriteName.slice(0, 120) : "",
  };
}

export function normalizeDesktopPetTtsSettings(value: unknown): DesktopPetTtsSettings {
  const source = value && typeof value === "object" ? value as Partial<DesktopPetTtsSettings> : {};
  const providers: DesktopPetTtsProvider[] = ["browser", "edge-tts", "openai-tts", "elevenlabs", "minimax-tts", "fish-audio"];
  const provider: DesktopPetTtsProvider = providers.includes(source.provider as DesktopPetTtsProvider)
    ? source.provider as DesktopPetTtsProvider
    : DEFAULT_DESKTOP_PET_TTS_SETTINGS.provider;
  const numberInRange = (candidate: unknown, fallback: number, min: number, max: number) => {
    const value = typeof candidate === "number" && Number.isFinite(candidate) ? candidate : fallback;
    return Math.min(max, Math.max(min, value));
  };
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_DESKTOP_PET_TTS_SETTINGS.enabled,
    autoPlay: typeof source.autoPlay === "boolean" ? source.autoPlay : DEFAULT_DESKTOP_PET_TTS_SETTINGS.autoPlay,
    provider,
    voice: typeof source.voice === "string" ? source.voice.slice(0, 120) : "",
    rate: numberInRange(source.rate, 1, 0.5, 2),
    volume: numberInRange(source.volume, 1, 0, 1),
    splitEnabled: typeof source.splitEnabled === "boolean" ? source.splitEnabled : DEFAULT_DESKTOP_PET_TTS_SETTINGS.splitEnabled,
    maxSentenceLength: Math.round(numberInRange(source.maxSentenceLength, 15, 5, 100)),
    apiBaseUrl: typeof source.apiBaseUrl === "string" ? source.apiBaseUrl.slice(0, 500) : "",
    apiKey: typeof source.apiKey === "string" ? source.apiKey.slice(0, 500) : "",
    model: typeof source.model === "string" && source.model.trim() ? source.model.slice(0, 120) : DEFAULT_DESKTOP_PET_TTS_SETTINGS.model,
    extraConfigs: source.extraConfigs && typeof source.extraConfigs === "object" && !Array.isArray(source.extraConfigs)
      ? Object.fromEntries(Object.entries(source.extraConfigs).map(([key, value]) => [key, value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([, item]) => ["string", "number", "boolean"].includes(typeof item))) : {}]))
      : {},
  };
}
