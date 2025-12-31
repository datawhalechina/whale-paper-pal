/**
 * API Types for Paper Pal frontend-backend communication.
 *
 * Requirements: 6.1, 7.2, 8.2
 */

// Paper types
export interface ApiPaper {
  id: string;
  title: string;
  abstract: string;
  authors: string[];
  categories: string[];
  published: string;
  source: 'arxiv' | 'huggingface';
  url: string;
  relevance_score?: number;
  novelty_score?: number;
  total_score?: number;
  one_liner?: string;
  pros?: string[];
  cons?: string[];
}

export interface PaperListResponse {
  papers: ApiPaper[];
  total: number;
}

export interface FetchPapersRequest {
  days?: number;
  max_results?: number;
}

export interface ScorePapersRequest {
  paper_ids?: string[];
  interests?: string[];
  threshold?: number;
}

export interface ScorePapersResponse {
  success: boolean;
  scored_count: number;
  filtered_count: number;
  papers: Array<{
    id: string;
    title: string;
    total_score: number;
    one_liner: string;
  }>;
}

// Chat types
export interface ChatMessageRequest {
  paper_id: string;
  message: string;
  history?: Array<{ role: string; content: string }>;
}

export interface ChatMessageResponse {
  role: 'assistant';
  content: string;
  timestamp: string;
}

export interface QuickCommandRequest {
  paper_id: string;
  command: '看公式' | '看代码链接';
}

// Notification types
export interface ApiNotification {
  id: string;
  paper_id: string;
  title: string;
  source: string;
  score: number;
  timestamp: string;
}

export interface NotificationListResponse {
  notifications: ApiNotification[];
}

// Save paper types
export interface SavePaperRequest {
  paper_id: string;
  user_id?: string;
}

export interface SavePaperResponse {
  success: boolean;
  message: string;
}

// Saved papers types
export interface SavedPaper {
  paper_id: string;
  saved_at: string;
  paper?: ApiPaper;
}

export interface SavedPapersListResponse {
  saved_papers: SavedPaper[];
  total: number;
}

// Health check
export interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  scheduler_running: boolean;
}
