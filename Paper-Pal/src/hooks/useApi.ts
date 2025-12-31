/**
 * React hooks for Paper Pal API integration.
 *
 * Requirements: 6.1, 7.2, 8.2
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  getApiClient,
  type ApiPaper,
  type ApiNotification,
  type ChatMessageResponse,
  type SavedPaper,
} from '../api';

// API connection state
export function useApiHealth() {
  const [isConnected, setIsConnected] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkHealth = useCallback(async () => {
    setIsChecking(true);
    setError(null);
    try {
      const client = getApiClient();
      await client.healthCheck();
      setIsConnected(true);
    } catch (err) {
      console.error('Health check failed:', err);
      setIsConnected(false);
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    // Check health every 30 seconds
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  return { isConnected, isChecking, error, checkHealth };
}

// Papers hook
export function usePapers() {
  const [papers, setPapers] = useState<ApiPaper[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPapers = useCallback(async (params?: {
    limit?: number;
    offset?: number;
    min_score?: number;
  }) => {
    setIsLoading(true);
    setError(null);
    try {
      const client = getApiClient();
      const response = await client.getPapers(params);
      setPapers(response.papers);
      return response.papers;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch papers';
      setError(message);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getPaper = useCallback(async (paperId: string) => {
    try {
      const client = getApiClient();
      return await client.getPaper(paperId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch paper';
      setError(message);
      return null;
    }
  }, []);

  const savePaper = useCallback(async (paperId: string) => {
    try {
      const client = getApiClient();
      const response = await client.savePaper({ paper_id: paperId });
      
      // 根据后端响应返回不同的结果
      if (response.success) {
        return true; // 成功保存
      } else if (response.message === "Paper already saved") {
        return false; // 已经保存过了
      } else {
        return null; // 其他错误
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save paper';
      setError(message);
      return null; // 网络或其他错误
    }
  }, []);

  return { papers, isLoading, error, fetchPapers, getPaper, savePaper };
}

// Saved papers hook
export function useSavedPapers() {
  const [savedPapers, setSavedPapers] = useState<SavedPaper[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSavedPapers = useCallback(async (params?: {
    user_id?: string;
    limit?: number;
    offset?: number;
  }) => {
    setIsLoading(true);
    setError(null);
    try {
      const client = getApiClient();
      const response = await client.getSavedPapers(params);
      setSavedPapers(response.saved_papers);
      return response.saved_papers;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch saved papers';
      setError(message);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  const removeSavedPaper = useCallback(async (paperId: string) => {
    try {
      const client = getApiClient();
      const response = await client.removeSavedPaper(paperId);
      if (response.success) {
        // Update local state to remove the paper
        setSavedPapers(prev => prev.filter(sp => sp.paper_id !== paperId));
        return true;
      }
      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove saved paper';
      setError(message);
      return false;
    }
  }, []);

  return { savedPapers, isLoading, error, fetchSavedPapers, removeSavedPaper };
}

// Scoring hook
export function useScoring() {
  const [isScoring, setIsScoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    scored_count: number;
    filtered_count: number;
  } | null>(null);

  const scorePapers = useCallback(async (params?: {
    interests?: string[];
    threshold?: number;
  }) => {
    setIsScoring(true);
    setError(null);
    try {
      const client = getApiClient();
      const response = await client.scorePapers(params);
      setResult({
        scored_count: response.scored_count,
        filtered_count: response.filtered_count,
      });
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to score papers';
      setError(message);
      return null;
    } finally {
      setIsScoring(false);
    }
  }, []);

  return { isScoring, error, result, scorePapers };
}

// Notifications hook
export function useNotifications(pollInterval: number = 10000) {
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchNotifications = useCallback(async () => {
    setIsLoading(true);
    try {
      const client = getApiClient();
      const response = await client.getNotifications();
      setNotifications(response.notifications);
      return response.notifications;
    } catch {
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  const dismissNotification = useCallback(async (notificationId: string) => {
    try {
      const client = getApiClient();
      await client.dismissNotification(notificationId);
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
      return true;
    } catch {
      return false;
    }
  }, []);

  const clearAll = useCallback(async () => {
    try {
      const client = getApiClient();
      await client.clearNotifications();
      setNotifications([]);
      return true;
    } catch {
      return false;
    }
  }, []);

  // Start polling
  useEffect(() => {
    fetchNotifications();
    intervalRef.current = setInterval(fetchNotifications, pollInterval);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchNotifications, pollInterval]);

  return {
    notifications,
    isLoading,
    fetchNotifications,
    dismissNotification,
    clearAll,
  };
}

// Chat hook
export function useChat(paperId: string | null) {
  const [messages, setMessages] = useState<Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(async (content: string): Promise<ChatMessageResponse | null> => {
    if (!paperId) {
      setError('No paper selected');
      return null;
    }

    setIsLoading(true);
    setError(null);

    // Add user message immediately
    const userMessage = {
      role: 'user' as const,
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const client = getApiClient();
      const response = await client.sendChatMessage({
        paper_id: paperId,
        message: content,
        history: messages.map((m) => ({ role: m.role, content: m.content })),
      });

      // Add assistant response
      const assistantMessage = {
        role: 'assistant' as const,
        content: response.content,
        timestamp: new Date(response.timestamp),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send message';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [paperId, messages]);

  const executeQuickCommand = useCallback(async (
    command: '看公式' | '看代码链接'
  ): Promise<ChatMessageResponse | null> => {
    if (!paperId) {
      setError('No paper selected');
      return null;
    }

    setIsLoading(true);
    setError(null);

    // Add user command as message
    const userMessage = {
      role: 'user' as const,
      content: command,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const client = getApiClient();
      const response = await client.executeQuickCommand({
        paper_id: paperId,
        command,
      });

      // Add assistant response
      const assistantMessage = {
        role: 'assistant' as const,
        content: response.content,
        timestamp: new Date(response.timestamp),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to execute command';
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [paperId]);

  const clearHistory = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  // Clear messages when paper changes
  useEffect(() => {
    setMessages([]);
    setError(null);
  }, [paperId]);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    executeQuickCommand,
    clearHistory,
  };
}
