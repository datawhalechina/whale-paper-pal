import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, LogOut, MessageSquare, Minimize2, Minus, Plus, Settings, Trash2, X } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import type { ChatMessage, DesktopPetSettings } from "../types";
import { askAssistant, loadAiSettings, saveAiSettings } from "../lib/ai";
import { readBrandedStorage } from "../lib/brand-storage";
import { DESKTOP_PET_WINDOW_SIZES, type DesktopPetContext } from "../lib/desktop-pet";
import { loadDailyPapers } from "../lib/discovery";
import { speakDesktopPet, stopDesktopPetTts } from "../lib/tts";
import { CodexPetSprite, type CodexPetAnimation } from "./CodexPetSprite";
import { DesktopPetChat } from "./DesktopPetChat";
import "../styles.css";

const LAST_SEEN_KEY = "whalepaper.desktop-pet.last-seen-paper.v1";
const CHAT_HISTORY_KEY = "whalepaper.desktop-pet.chat.v1";
const CHAT_COLLAPSED_KEY = "whalepaper.desktop-pet.chat-collapsed.v1";
const MAX_HISTORY_MESSAGES = 30;

function loadChatHistory(): ChatMessage[] {
  try {
    const value = JSON.parse(readBrandedStorage(CHAT_HISTORY_KEY) || "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const message = item as Partial<ChatMessage>;
      if ((message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string" || !message.content.trim()) return [];
      return [{
        id: typeof message.id === "string" ? message.id : crypto.randomUUID(),
        role: message.role,
        content: message.content.slice(0, 12_000),
        createdAt: typeof message.createdAt === "string" ? message.createdAt : undefined,
      }];
    }).slice(-MAX_HISTORY_MESSAGES);
  } catch {
    return [];
  }
}

export function DesktopPet() {
  const [animation, setAnimation] = useState<CodexPetAnimation>("running");
  const [hasUnreadRecommendation, setHasUnreadRecommendation] = useState(false);
  const [latestPaper, setLatestPaper] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(() => readBrandedStorage(CHAT_COLLAPSED_KEY) === "true");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(loadChatHistory);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [readerContext, setReaderContext] = useState<DesktopPetContext | null>(null);
  const [settings, setSettings] = useState<DesktopPetSettings>(() => loadAiSettings().desktopPet);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const latestPaperRef = useRef("");
  const hasUnreadRecommendationRef = useRef(false);
  const animationTimerRef = useRef<number | null>(null);
  const dragSettleTimerRef = useRef<number | null>(null);
  const dragStartFrameRef = useRef<number | null>(null);
  const lastWindowXRef = useRef<number | null>(null);
  const chatRequestRef = useRef(0);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const petWindow = useMemo(() => isTauri() ? getCurrentWindow() : null, []);

  useEffect(() => () => { stopDesktopPetTts(); }, []);

  const clearAnimationTimer = useCallback(() => {
    if (animationTimerRef.current === null) return;
    window.clearTimeout(animationTimerRef.current);
    animationTimerRef.current = null;
  }, []);

  const restoreRestingAnimation = useCallback(() => {
    clearAnimationTimer();
    setAnimation(hasUnreadRecommendationRef.current ? "review" : "idle");
  }, [clearAnimationTimer]);

  const playTransientAnimation = useCallback((next: CodexPetAnimation, duration: number) => {
    clearAnimationTimer();
    setAnimation(next);
    animationTimerRef.current = window.setTimeout(restoreRestingAnimation, duration);
  }, [clearAnimationTimer, restoreRestingAnimation]);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    restoreRestingAnimation();
  }, [restoreRestingAnimation]);

  const setUnreadRecommendation = useCallback((unread: boolean) => {
    hasUnreadRecommendationRef.current = unread;
    setHasUnreadRecommendation(unread);
  }, []);

  const clearDragTimers = useCallback(() => {
    if (dragSettleTimerRef.current !== null) window.clearTimeout(dragSettleTimerRef.current);
    if (dragStartFrameRef.current !== null) window.cancelAnimationFrame(dragStartFrameRef.current);
    dragSettleTimerRef.current = null;
    dragStartFrameRef.current = null;
  }, []);

  const finishDragAnimation = useCallback(() => {
    clearDragTimers();
    dragging.current = false;
    pointerStart.current = null;
    lastWindowXRef.current = null;
    restoreRestingAnimation();
  }, [clearDragTimers, restoreRestingAnimation]);

  const scheduleDragFinish = useCallback(() => {
    if (dragSettleTimerRef.current !== null) window.clearTimeout(dragSettleTimerRef.current);
    dragSettleTimerRef.current = window.setTimeout(finishDragAnimation, 600);
  }, [finishDragAnimation]);

  const moveToDefaultPosition = useCallback(async () => {
    if (!petWindow) return;
    const [monitor, windowSize] = await Promise.all([primaryMonitor(), petWindow.outerSize()]);
    if (!monitor) return;
    const x = monitor.workArea.position.x + monitor.workArea.size.width - windowSize.width - 40 * monitor.scaleFactor;
    const y = monitor.workArea.position.y + monitor.workArea.size.height - windowSize.height - 40 * monitor.scaleFactor;
    await petWindow.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
  }, [petWindow]);

  const resizePetWindow = useCallback(async (size: { width: number; height: number }) => {
    if (!petWindow) return;
    try {
      const [position, currentSize, scaleFactor] = await Promise.all([
        petWindow.outerPosition(),
        petWindow.outerSize(),
        petWindow.scaleFactor(),
      ]);
      const nextWidth = Math.round(size.width * scaleFactor);
      const nextHeight = Math.round(size.height * scaleFactor);
      await petWindow.setSize(new LogicalSize(size.width, size.height));
      await petWindow.setPosition(new PhysicalPosition(
        position.x + currentSize.width - nextWidth,
        position.y + currentSize.height - nextHeight,
      ));
    } catch {
      await petWindow.setSize(new LogicalSize(size.width, size.height));
    }
  }, [petWindow]);

  // The floating window follows the visible content: when the speech bubble
  // and composer are hidden, keep only the sprite footprint reserving space.
  useEffect(() => {
    if (!petWindow) return;
    const base = DESKTOP_PET_WINDOW_SIZES[settings.windowSize];
    const spriteOnlyHeight = Math.round(238 * settings.avatarScale);
    void resizePetWindow({ width: base.width, height: chatCollapsed && !menuOpen ? spriteOnlyHeight : base.height });
  }, [chatCollapsed, menuOpen, petWindow, resizePetWindow, settings.avatarScale, settings.windowSize]);

  const applyWindowSettings = useCallback(async (next: DesktopPetSettings, resetPosition = false) => {
    setSettings(next);
    if (!petWindow) return;
    const size = DESKTOP_PET_WINDOW_SIZES[next.windowSize];
    const wasVisible = await petWindow.isVisible();
    await petWindow.setAlwaysOnTop(next.alwaysOnTop);
    await resizePetWindow(size);
    if (!next.enabled) {
      await petWindow.hide();
      return;
    }
    if (!wasVisible) await petWindow.show();
    if (resetPosition) await moveToDefaultPosition();
  }, [moveToDefaultPosition, petWindow, resizePetWindow]);

  useEffect(() => {
    document.documentElement.classList.add("pet-window");
    const initialSettings = loadAiSettings().desktopPet;
    void applyWindowSettings(initialSettings, true);
    setAnimation("running");
    void loadDailyPapers().then((papers) => {
      const latest = papers[0]?.slug || "";
      latestPaperRef.current = latest;
      setLatestPaper(latest);
      const unread = Boolean(initialSettings.recommendationAlerts && latest && readBrandedStorage(LAST_SEEN_KEY) !== latest);
      setUnreadRecommendation(unread);
      setAnimation(unread ? "review" : "idle");
    }).catch(() => playTransientAnimation("failed", 3000));
    let disposed = false;
    let cleanups: Array<() => void> = [];
    if (petWindow) void Promise.all([
      petWindow.listen<DesktopPetSettings>("desktop-pet-settings-changed", (event) => {
        const latest = latestPaperRef.current;
        const unread = Boolean(event.payload.recommendationAlerts && latest && readBrandedStorage(LAST_SEEN_KEY) !== latest);
        setUnreadRecommendation(unread);
        setAnimation(unread ? "review" : "idle");
        void applyWindowSettings(event.payload);
      }),
      petWindow.listen("desktop-pet-reset-position", () => void moveToDefaultPosition()),
      petWindow.listen<DesktopPetContext>("desktop-pet-context-response", (event) => setReaderContext(event.payload)),
      petWindow.onMoved(({ payload: position }) => {
        if (!dragging.current) return;
        const previousX = lastWindowXRef.current;
        if (previousX !== null && position.x !== previousX) {
          setAnimation(position.x < previousX ? "running-left" : "running-right");
        }
        lastWindowXRef.current = position.x;
        scheduleDragFinish();
      }),
    ]).then((unlistens) => {
      if (disposed) unlistens.forEach((unlisten) => unlisten());
      else cleanups = unlistens;
    });
    if (petWindow) void petWindow.emitTo("main", "desktop-pet-context-request");
    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
      clearAnimationTimer();
      clearDragTimers();
      chatRequestRef.current += 1;
      document.documentElement.classList.remove("pet-window");
    };
  }, [applyWindowSettings, clearAnimationTimer, clearDragTimers, moveToDefaultPosition, petWindow, playTransientAnimation, scheduleDragFinish, setUnreadRecommendation]);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDownOutside = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (menuRef.current?.contains(event.target as Node)) return;
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeMenu();
    };

    document.addEventListener("pointerdown", handlePointerDownOutside, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDownOutside, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMenu, menuOpen]);

  const showMainWindow = async () => {
    if (latestPaper) localStorage.setItem(LAST_SEEN_KEY, latestPaper);
    setUnreadRecommendation(false);
    playTransientAnimation("jumping", 2000);
    setMenuOpen(false);
    if (!petWindow) return;
    const mainWindow = await WebviewWindow.getByLabel("main");
    if (!mainWindow) return;
    await mainWindow.show();
    await mainWindow.unminimize();
    await mainWindow.setFocus();
    return mainWindow;
  };

  const openConfiguredTarget = async () => {
    const mainWindow = await showMainWindow();
    if (!mainWindow || !petWindow) return;
    await petWindow.emitTo("main", "open-home-mode", settings.openTarget);
  };

  const saveChatMessages = useCallback((messages: ChatMessage[]) => {
    const limited = messages.slice(-MAX_HISTORY_MESSAGES);
    setChatMessages(limited);
    try {
      localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(limited));
    } catch { /* Chat history remains available for this session. */ }
  }, []);

  const sendChatMessage = useCallback(async (content: string) => {
    stopDesktopPetTts();
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...chatMessages, userMessage].slice(-MAX_HISTORY_MESSAGES);
    saveChatMessages(nextMessages);
    setChatError("");
    setChatLoading(true);
    clearAnimationTimer();
    setAnimation("waiting");
    const requestId = chatRequestRef.current + 1;
    chatRequestRef.current = requestId;
    const contextParts = [
      "你是 WhalePaper 里的鲸鱼科研伙伴。回答要准确、友好且简洁，默认不超过 220 个中文字；用户要求详细时再展开。",
      readerContext?.title ? `当前论文：${readerContext.title}\n当前页：${readerContext.page}` : "当前没有打开论文。",
      readerContext?.pageText ? `当前页原文：\n${readerContext.pageText.slice(0, 7000)}` : "",
      readerContext?.selectedText ? `用户当前选中的文本：\n${readerContext.selectedText.slice(0, 2500)}` : "",
    ].filter(Boolean).join("\n\n");
    try {
      const response = await askAssistant(loadAiSettings(), nextMessages.slice(-10), contextParts, "desktopPet", {
        maxOutputTokens: 768,
        temperature: 0.35,
      });
      if (chatRequestRef.current !== requestId) return;
      saveChatMessages([...nextMessages, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response,
        createdAt: new Date().toISOString(),
      }]);
      setChatLoading(false);
      playTransientAnimation("waving", 2200);
      const allSettings = loadAiSettings();
      if (allSettings.desktopPetTts.enabled && allSettings.desktopPetTts.autoPlay) void speakDesktopPet(response, allSettings.desktopPetTts, allSettings);
    } catch (error) {
      if (chatRequestRef.current !== requestId) return;
      setChatLoading(false);
      setChatError(error instanceof Error ? error.message : "暂时无法回答，请稍后再试。");
      playTransientAnimation("failed", 3000);
    }
  }, [chatMessages, clearAnimationTimer, playTransientAnimation, readerContext, saveChatMessages]);

  const stopChatMessage = useCallback(() => {
    chatRequestRef.current += 1;
    stopDesktopPetTts();
    setChatLoading(false);
    setChatError("");
    restoreRestingAnimation();
  }, [restoreRestingAnimation]);

  const clearChat = useCallback(() => {
    stopChatMessage();
    saveChatMessages([]);
  }, [saveChatMessages, stopChatMessage]);

  const openDiscovery = async () => {
    const mainWindow = await showMainWindow();
    if (!mainWindow || !petWindow) return;
    await petWindow.emitTo("main", "open-home-mode", "discovery");
  };

  const openPetSettings = async () => {
    const mainWindow = await showMainWindow();
    if (!mainWindow || !petWindow) return;
    await petWindow.emitTo("main", "open-desktop-pet-settings");
  };

  const collapsePet = async () => {
    const next = { ...settings, enabled: false };
    const allSettings = loadAiSettings();
    stopChatMessage();
    setMenuOpen(false);
    setSettings(next);
    saveAiSettings({ ...allSettings, desktopPet: next });
    if (!petWindow) return;
    try {
      await petWindow.emitTo("main", "desktop-pet-settings-updated", next);
    } finally {
      await petWindow.hide();
    }
  };

  const changeAvatarScale = (direction: -1 | 1) => {
    const scales = [0.75, 1, 1.15];
    const currentIndex = scales.findIndex((scale) => Math.abs(scale - settings.avatarScale) < 0.01);
    const nextIndex = Math.min(scales.length - 1, Math.max(0, (currentIndex < 0 ? 1 : currentIndex) + direction));
    const next = { ...settings, avatarScale: scales[nextIndex] };
    setSettings(next);
    const allSettings = loadAiSettings();
    saveAiSettings({ ...allSettings, desktopPet: next });
    if (petWindow) void petWindow.emitTo("main", "desktop-pet-settings-updated", next);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    pointerStart.current = { x: event.clientX, y: event.clientY };
    dragging.current = false;
    closeMenu();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!pointerStart.current || dragging.current || event.buttons !== 1) return;
    const distance = Math.hypot(event.clientX - pointerStart.current.x, event.clientY - pointerStart.current.y);
    if (distance < 5) return;
    dragging.current = true;
    clearAnimationTimer();
    clearDragTimers();
    setAnimation(event.clientX < pointerStart.current.x ? "running-left" : "running-right");
    if (!petWindow) return;
    void petWindow.outerPosition().then((position) => {
      lastWindowXRef.current = position.x;
    });
    dragStartFrameRef.current = window.requestAnimationFrame(() => {
      dragStartFrameRef.current = window.requestAnimationFrame(() => {
        dragStartFrameRef.current = null;
        if (!dragging.current) return;
        void petWindow.startDragging().then(scheduleDragFinish).catch(finishDragAnimation);
      });
    });
  };

  const handlePointerUp = () => {
    if (pointerStart.current && !dragging.current) {
      pointerStart.current = null;
      playTransientAnimation("waving", 1600);
    }
    else if (dragging.current) finishDragAnimation();
    else pointerStart.current = null;
  };

  const handleDoubleClick = () => {
    void openConfiguredTarget();
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    const nextOpen = !menuOpen;
    if (!nextOpen) {
      closeMenu();
      return;
    }
    setMenuOpen(true);
    clearAnimationTimer();
    setAnimation("waiting");
  };

  const petUiProgress = Math.min(1, Math.max(0, (settings.avatarScale - 0.75) / 0.4));
  const petUiStyle = {
    "--desktop-pet-panel-width": `${Math.round(194.4 * settings.avatarScale + 28)}px`,
    "--desktop-pet-panel-font": `${(8.5 + petUiProgress * 2.5).toFixed(2)}px`,
    "--desktop-pet-dialog-height": `${Math.round(36 + petUiProgress * 18)}px`,
    "--desktop-pet-dialog-padding": `${Math.round(7 + petUiProgress * 4)}px`,
    "--desktop-pet-composer-height": `${Math.round(40 + petUiProgress * 16)}px`,
    "--desktop-pet-composer-padding": `${Math.round(5 + petUiProgress * 3)}px`,
    "--desktop-pet-control-size": `${Math.round(24 + petUiProgress * 7)}px`,
    "--desktop-pet-control-icon": `${Math.round(12 + petUiProgress * 4)}px`,
    "--desktop-pet-panel-radius": `${Math.round(9 + petUiProgress * 4)}px`,
    "--desktop-pet-panel-shadow-alpha": `${(0.12 + petUiProgress * 0.08).toFixed(3)}`,
  } as React.CSSProperties;

  return (
    <main
      className={`desktop-pet ${chatCollapsed ? "is-chat-collapsed" : ""}`}
      style={petUiStyle}
      onContextMenu={handleContextMenu}
    >
      <DesktopPetChat
        avatar={(
          <button
            type="button"
            className="desktop-pet-avatar"
            aria-label="WhalePaper 桌面精灵"
            title="拖动鲸鱼移动窗口；双击打开 WhalePaper"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={finishDragAnimation}
            onDoubleClick={handleDoubleClick}
            onPointerEnter={() => { if (!menuOpen) { clearAnimationTimer(); setAnimation("waving"); } }}
            onPointerLeave={() => { if (!menuOpen && !dragging.current) restoreRestingAnimation(); }}
          >
            <CodexPetSprite animation={animation} size={settings.avatarScale * 1.35} skin={settings.skin} source={settings.customSpriteDataUrl || undefined} />
          </button>
        )}
        messages={chatMessages}
        context={readerContext}
        loading={chatLoading}
        error={chatError}
        notice={settings.recommendationAlerts && hasUnreadRecommendation ? "今日论文推荐已更新，双击我去看看吧。" : undefined}
        onSend={(value) => void sendChatMessage(value)}
        onStop={stopChatMessage}
      />
      {menuOpen && (
        <div ref={menuRef} className="desktop-pet-menu" role="menu" aria-label="桌宠菜单">
          <div className="desktop-pet-menu-header">
            <span>桌宠菜单</span>
            <button type="button" aria-label="收起桌宠菜单" title="收起" onClick={closeMenu}><X size={14} /></button>
          </div>
          <button type="button" onClick={() => void openDiscovery()}><BookOpen size={14} />打开论文发现</button>
          <button type="button" onClick={() => {
            const nextCollapsed = !chatCollapsed;
            setChatCollapsed(nextCollapsed);
            localStorage.setItem(CHAT_COLLAPSED_KEY, String(nextCollapsed));
            closeMenu();
          }}><MessageSquare size={14} />{chatCollapsed ? "展开对话框" : "收起对话框"}</button>
          <button type="button" disabled={!chatMessages.length || chatLoading} onClick={clearChat}><Trash2 size={14} />清空对话</button>
          <button type="button" disabled={settings.avatarScale <= 0.75} onClick={() => changeAvatarScale(-1)}><Minus size={14} />缩小精灵</button>
          <button type="button" disabled={settings.avatarScale >= 1.15} onClick={() => changeAvatarScale(1)}><Plus size={14} />放大精灵</button>
          <button type="button" onClick={() => void openPetSettings()}><Settings size={14} />桌宠设置</button>
          <button type="button" onClick={() => void collapsePet()}><Minimize2 size={14} />收起精灵</button>
          <button type="button" onClick={() => { if (petWindow) void invoke("quit_app"); }}><LogOut size={14} />退出 WhalePaper</button>
        </div>
      )}
    </main>
  );
}
