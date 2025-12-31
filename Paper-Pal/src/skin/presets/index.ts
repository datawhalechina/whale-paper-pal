/**
 * 预设精灵皮肤系统
 * 提供多套精美的预设皮肤供用户选择
 */

export interface PresetSkinAsset {
  idle: string;
  alert: string;
  active: string;
}

export interface PresetSkin {
  id: string;
  name: string;
  description: string;
  author?: string;
  assets: PresetSkinAsset;
  tags: string[];
  // 预览使用 idle 状态的图片，不需要单独的 preview 字段
}

// 获取皮肤资源的基础路径（兼容开发环境和生产环境）
function getSkinBasePath(): string {
  // 检查是否在浏览器环境中
  if (typeof window === 'undefined') {
    // 服务端渲染时使用绝对路径
    return '/skins';
  }
  
  // 在 Electron 生产环境中使用相对路径
  // 检查是否在 file:// 协议下运行
  if (window.location.protocol === 'file:') {
    return './skins';
  }
  
  // 开发环境使用绝对路径
  return '/skins';
}

// 预设皮肤配置
export const PRESET_SKINS: PresetSkin[] = [
  {
    id: 'default',
    name: '默认表情',
    description: '经典的表情符号风格',
    assets: {
      idle: '😴',
      alert: '😲',
      active: '😊',
    },
    tags: ['经典'],
  },
  {
    id: 'cat-spirit',
    name: '猫咪精灵',
    description: '可爱的猫咪主题皮肤',
    author: 'WhalePaper Team',
    assets: {
      idle: '/skins/cat-spirit/idle.png',
      alert: '/skins/cat-spirit/alert.png',
      active: '/skins/cat-spirit/active.png',
    },
    tags: ['可爱'],
  },
  {
    id: 'datawhale-spirit',
    name: 'Datawhale精灵',
    description: 'Datawhale社区主题皮肤',
    author: 'Datawhale',
    assets: {
      idle: '/skins/datawhale-spirit/idle.png',
      alert: '/skins/datawhale-spirit/alert.png',
      active: '/skins/datawhale-spirit/active.png',
    },
    tags: ['社区'],
  },
  {
    id: 'panda-spirit',
    name: '熊猫精灵',
    description: '憨态可掬的熊猫主题皮肤',
    author: 'WhalePaper Team',
    assets: {
      idle: '/skins/panda-spirit/idle.png',
      alert: '/skins/panda-spirit/alert.png',
      active: '/skins/panda-spirit/active.png',
    },
    tags: ['可爱'],
  },
  {
    id: 'robot-assistant',
    name: '机器人助手',
    description: '科技感十足的机器人主题',
    author: 'WhalePaper Team',
    assets: {
      idle: '/skins/robot-assistant/idle.png',
      alert: '/skins/robot-assistant/alert.png',
      active: '/skins/robot-assistant/active.png',
    },
    tags: ['科技'],
  },
];

// 获取带有正确路径的皮肤资源
export function getPresetSkinsWithCorrectPaths(): PresetSkin[] {
  const basePath = getSkinBasePath();
  
  return PRESET_SKINS.map(skin => {
    // 默认皮肤使用表情符号，不需要修改路径
    if (skin.id === 'default') {
      return skin;
    }
    
    // 修正图片路径
    return {
      ...skin,
      assets: {
        idle: skin.assets.idle.replace('/skins', basePath),
        alert: skin.assets.alert.replace('/skins', basePath),
        active: skin.assets.active.replace('/skins', basePath),
      },
    };
  });
}

// 根据标签筛选皮肤
export function getSkinsByTag(tag: string): PresetSkin[] {
  return getPresetSkinsWithCorrectPaths().filter(skin => skin.tags.includes(tag));
}

// 根据ID获取皮肤
export function getSkinById(id: string): PresetSkin | undefined {
  return getPresetSkinsWithCorrectPaths().find(skin => skin.id === id);
}

// 获取所有标签
export function getAllTags(): string[] {
  const tags = new Set<string>();
  PRESET_SKINS.forEach(skin => {
    skin.tags.forEach(tag => tags.add(tag));
  });
  return Array.from(tags).sort();
}