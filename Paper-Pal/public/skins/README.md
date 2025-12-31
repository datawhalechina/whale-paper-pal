# 皮肤资源目录

这个目录包含了所有预设皮肤的资源文件。

## 目录结构

```
public/skins/
├── cat-spirit/
│   ├── idle.png            # 待机状态图片
│   ├── alert.png           # 提醒状态图片
│   └── active.png          # 活跃状态图片
├── robot-assistant/
│   ├── idle.png
│   ├── alert.png
│   └── active.png
├── magic-crystal/
│   ├── idle.png
│   ├── alert.png
│   └── active.png
├── paper-scholar/
│   ├── idle.png
│   ├── alert.png
│   └── active.png
└── pixel-buddy/
    ├── idle.png
    ├── alert.png
    └── active.png
```

## 皮肤规范

### 图片要求
- **格式**: PNG (静态) 或 GIF (动画)
- **尺寸**: 建议 128x128 像素
- **背景**: 透明背景
- **文件大小**: 单个文件不超过 2MB

### 动画要求 (如果使用GIF)
- **帧率**: 10-15 FPS
- **循环**: 无限循环
- **时长**: 1-3 秒为佳

### 命名规范
- `idle.png/gif`: 待机状态，平时显示，也用作预览图
- `alert.png/gif`: 提醒状态，有新消息时显示
- `active.png/gif`: 活跃状态，用户交互时显示

## 预览图说明

不需要单独的预览图！系统会自动使用 `idle.png/gif` 作为皮肤选择界面的预览图。这样：
- 减少了文件数量
- 保持了一致性
- 用户看到的预览就是实际的待机状态

## 添加新皮肤

1. 在 `public/skins/` 下创建新目录
2. 添加 `idle.png`、`alert.png`、`active.png` 三个文件
3. 在 `src/skin/presets/index.ts` 中添加皮肤配置
4. 重新编译应用

## 版权说明

所有皮肤资源应确保有合法的使用权限。建议使用：
- 自制原创作品
- 开源/免费资源
- 已获得授权的商业资源

请在皮肤配置中注明作者信息。