import { useEffect, useState } from "react";
import type { DesktopPetSkin } from "../types";

export type CodexPetAnimation =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

const SPRITESHEET_PATH = "/skins/agent-pet-codex/spritesheet.webp";
const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;
const ATLAS_WIDTH = 1536;
const ATLAS_HEIGHT = 1872;
const BASE_SCALE = 0.75;
const SPRITESHEET_VERSION = "20260828-2";

export const DESKTOP_PET_SKINS: Array<{ id: Exclude<DesktopPetSkin, "custom">; label: string; description: string }> = [
  { id: "datawhale-spirit", label: "小鲸鱼", description: "安静陪读" },
  { id: "cat-spirit", label: "星光猫", description: "灵动专注" },
  { id: "panda-spirit", label: "读书熊猫", description: "沉浸阅读" },
  { id: "robot-assistant", label: "助手机器人", description: "科技助手" },
];

const ANIMATIONS: Record<CodexPetAnimation, { row: number; durations: number[] }> = {
  idle: { row: 0, durations: [280, 110, 110, 140, 140, 320] },
  "running-right": { row: 1, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  "running-left": { row: 2, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  waving: { row: 3, durations: [140, 140, 140, 280] },
  jumping: { row: 4, durations: [140, 140, 140, 140, 280] },
  failed: { row: 5, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting: { row: 6, durations: [150, 150, 150, 150, 150, 260] },
  running: { row: 7, durations: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, durations: [150, 150, 150, 150, 150, 280] },
};

type CodexPetSpriteProps = {
  animation: CodexPetAnimation;
  size?: number;
  animated?: boolean;
  className?: string;
  source?: string;
  skin?: DesktopPetSkin;
};

export function CodexPetSprite({ animation, size = 1, animated = true, className = "", source = SPRITESHEET_PATH, skin = "datawhale-spirit" }: CodexPetSpriteProps) {
  const [frame, setFrame] = useState(0);
  const config = ANIMATIONS[animation];
  const scale = BASE_SCALE * size;
  const width = CELL_WIDTH * scale;
  const height = CELL_HEIGHT * scale;
  const spriteSource = skin === "custom" ? source : `/skins/${skin}/spritesheet.webp?v=${SPRITESHEET_VERSION}`;

  useEffect(() => {
    setFrame(0);
  }, [animation]);

  useEffect(() => {
    if (!animated) return;
    const timer = window.setTimeout(
      () => setFrame((current) => (current + 1) % config.durations.length),
      config.durations[frame % config.durations.length],
    );
    return () => window.clearTimeout(timer);
  }, [animated, config, frame]);

  return (
    <span
      aria-hidden="true"
      className={`codex-pet-sprite ${className}`.trim()}
      data-animation={animation}
      style={{
        width,
        height,
        backgroundImage: `url(${spriteSource})`,
        backgroundPosition: `${-(frame * width)}px ${-(config.row * height)}px`,
        backgroundSize: `${ATLAS_WIDTH * scale}px ${ATLAS_HEIGHT * scale}px`,
      }}
    />
  );
}
