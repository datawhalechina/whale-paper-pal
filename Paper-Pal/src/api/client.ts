/**
 * API Client for Paper Pal frontend-backend communication.
 *
 * Requirements: 6.1, 7.2, 8.2
 */

import type {
  ApiPaper,
  PaperListResponse,
  FetchPapersRequest,
  ScorePapersRequest,
  ScorePapersResponse,
  ChatMessageRequest,
  ChatMessageResponse,
  QuickCommandRequest,
  NotificationListResponse,
  SavePaperRequest,
  SavePaperResponse,
  SavedPapersListResponse,
  HealthResponse,
} from './types';

const DEFAULT_BASE_URL = 'http://localhost:8002';

export class PaperPalApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    try {
      // Add timeout to prevent hanging requests
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(error.detail || `HTTP ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (fetchError: any) {
      if (fetchError?.name === 'AbortError') {
        throw new Error('Request timeout - backend may be unresponsive');
      }
      
      throw fetchError;
    }
  }

  // Health check
  async healthCheck(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health');
  }

  // Papers API
  async getPapers(params?: {
    limit?: number;
    offset?: number;
    min_score?: number;
  }): Promise<PaperListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());
    if (params?.min_score) searchParams.set('min_score', params.min_score.toString());

    const query = searchParams.toString();
    return this.request<PaperListResponse>(`/api/papers/${query ? `?${query}` : ''}`);
  }

  async getPaper(paperId: string): Promise<ApiPaper> {
    return this.request<ApiPaper>(`/api/papers/${encodeURIComponent(paperId)}`);
  }

  async fetchPapers(request?: FetchPapersRequest): Promise<{
    success: boolean;
    count: number;
    papers: ApiPaper[];
  }> {
    return this.request('/api/papers/fetch', {
      method: 'POST',
      body: JSON.stringify(request || {}),
    });
  }

  async scorePapers(request?: ScorePapersRequest): Promise<ScorePapersResponse> {
    return this.request('/api/papers/score', {
      method: 'POST',
      body: JSON.stringify(request || {}),
    });
  }

  async savePaper(request: SavePaperRequest): Promise<SavePaperResponse> {
    return this.request('/api/papers/save', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async getSavedPapers(params?: {
    user_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<SavedPapersListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.user_id) searchParams.set('user_id', params.user_id);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return this.request<SavedPapersListResponse>(`/api/papers/saved${query ? `?${query}` : ''}`);
  }

  async removeSavedPaper(paperId: string, userId: string = 'default'): Promise<{ success: boolean; message: string }> {
    const searchParams = new URLSearchParams();
    searchParams.set('paper_id', paperId);
    searchParams.set('user_id', userId);
    
    return this.request(`/api/papers/saved/remove?${searchParams.toString()}`, {
      method: 'DELETE',
    });
  }

  // Chat API
  async sendChatMessage(request: ChatMessageRequest): Promise<ChatMessageResponse> {
    return this.request('/api/chat/message', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async executeQuickCommand(request: QuickCommandRequest): Promise<ChatMessageResponse> {
    return this.request('/api/chat/quick-command', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async chatWithPDF(request: {
    paper_id: string;
    message: string;
    history: Array<{ role: string; content: string }>;
    max_context_tokens: number;
  }): Promise<ChatMessageResponse> {
    return this.request('/api/pdf/chat', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // Notifications API
  async getNotifications(): Promise<NotificationListResponse> {
    return this.request<NotificationListResponse>('/api/notifications/');
  }

  async dismissNotification(notificationId: string): Promise<{ success: boolean }> {
    return this.request(`/api/notifications/${encodeURIComponent(notificationId)}`, {
      method: 'DELETE',
    });
  }

  async clearNotifications(): Promise<{ success: boolean }> {
    return this.request('/api/notifications/', {
      method: 'DELETE',
    });
  }

  // PDF RAG API
  async processPDF(request: {
    paper_id: string;
    pdf_url: string;
  }): Promise<{
    success: boolean;
    message: string;
    chunks_count?: number;
  }> {
    return this.request('/api/pdf/process', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async getPDFStatus(paperId: string): Promise<{
    paper_id: string;
    is_downloading: boolean;
    is_processing: boolean;
    is_complete: boolean;
    progress: number;
    error_message?: string;
    total_chunks: number;
    processed_chunks: number;
    pdf_processed: boolean;
    has_context: boolean;
  }> {
    return this.request(`/api/pdf/status?paper_id=${encodeURIComponent(paperId)}`);
  }

  async searchPDFContent(request: {
    paper_id: string;
    query: string;
    search_type?: 'semantic' | 'keyword';
    top_k?: number;
  }): Promise<{
    paper_id: string;
    query: string;
    search_type: string;
    results: Array<{
      chunk_id: string;
      content: string;
      page_number: number;
      relevance_score: number;
    }>;
    total_results: number;
  }> {
    return this.request('/api/pdf/search', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }
}

// Singleton instance
let apiClient: PaperPalApiClient | null = null;

export function getApiClient(baseUrl?: string): PaperPalApiClient {
  if (!apiClient || baseUrl) {
    apiClient = new PaperPalApiClient(baseUrl);
  }
  return apiClient;
}

export function setApiBaseUrl(baseUrl: string): void {
  apiClient = new PaperPalApiClient(baseUrl);
}
