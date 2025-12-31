"""API request/response models for Paper Pal backend.

Requirements: 6.1, 6.2, 7.2, 8.2
"""

from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


# Paper models
class PaperResponse(BaseModel):
    """Paper data response model."""
    id: str
    title: str
    abstract: str
    authors: List[str]
    categories: List[str]
    published: datetime
    source: str
    url: str
    relevance_score: Optional[float] = None
    novelty_score: Optional[float] = None
    total_score: Optional[float] = None
    one_liner: Optional[str] = None
    pros: Optional[List[str]] = None
    cons: Optional[List[str]] = None


class PaperListResponse(BaseModel):
    """Response for paper list endpoint."""
    papers: List[PaperResponse]
    total: int


class FetchPapersRequest(BaseModel):
    """Request to fetch new papers."""
    days: int = Field(default=1, ge=1, le=7)
    max_results: int = Field(default=50, ge=1, le=200)


class ScorePapersRequest(BaseModel):
    """Request to score papers."""
    paper_ids: Optional[List[str]] = None
    interests: List[str] = Field(default_factory=list)
    threshold: float = Field(default=7.0, ge=0, le=20)


# Chat models
class ChatMessageRequest(BaseModel):
    """Request to send a chat message."""
    paper_id: str
    message: str
    history: List[dict] = Field(default_factory=list)


class ChatMessageResponse(BaseModel):
    """Response from chat endpoint."""
    role: str = "assistant"
    content: str
    timestamp: datetime


class QuickCommandRequest(BaseModel):
    """Request for quick command execution."""
    paper_id: str
    command: str  # "看公式" or "看代码链接"


# Notification models
class NotificationResponse(BaseModel):
    """Notification data for bubble notifier."""
    id: str
    paper_id: str
    title: str
    source: str
    score: float
    timestamp: datetime


class NotificationListResponse(BaseModel):
    """Response for notifications endpoint."""
    notifications: List[NotificationResponse]


# Save paper models
class SavePaperRequest(BaseModel):
    """Request to save a paper for later."""
    paper_id: str
    user_id: str = "default"


class SavePaperResponse(BaseModel):
    """Response for save paper endpoint."""
    success: bool
    message: str


class SavedPaperResponse(BaseModel):
    """Single saved paper response."""
    paper_id: str
    saved_at: datetime
    paper: Optional[PaperResponse] = None


class SavedPapersListResponse(BaseModel):
    """Response for saved papers list endpoint."""
    saved_papers: List[SavedPaperResponse]
    total: int


class GetSavedPapersRequest(BaseModel):
    """Request to get saved papers."""
    user_id: str = "default"
    limit: int = Field(default=50, ge=1, le=200)
    offset: int = Field(default=0, ge=0)


# PDF processing models
class PDFProcessingRequest(BaseModel):
    """Request to start PDF processing."""
    paper_id: str
    pdf_url: str


class PDFProcessingResponse(BaseModel):
    """Response for PDF processing request."""
    success: bool
    message: str
    chunks_count: Optional[int] = None


class PDFStatusResponse(BaseModel):
    """Response for PDF processing status."""
    paper_id: str
    is_downloading: bool
    is_processing: bool
    is_complete: bool
    progress: float  # 0.0 to 1.0
    error_message: Optional[str] = None
    total_chunks: int
    processed_chunks: int
    pdf_processed: bool
    has_context: bool


# Enhanced chat models for RAG
class RAGChatMessageRequest(BaseModel):
    """Request for RAG-based chat message."""
    paper_id: str
    message: str
    history: List[Dict[str, Any]] = Field(default_factory=list)
    use_pdf_context: bool = True
    max_context_tokens: int = Field(default=3000, ge=1000, le=8000)


class PDFSearchRequest(BaseModel):
    """Request for PDF content search."""
    paper_id: str
    query: str
    search_type: str = Field(default="semantic", pattern="^(semantic|keyword)$")
    top_k: int = Field(default=5, ge=1, le=20)


class PDFSearchResult(BaseModel):
    """Single PDF search result."""
    chunk_id: str
    content: str
    page_number: int
    relevance_score: float


class PDFSearchResponse(BaseModel):
    """Response for PDF search endpoint."""
    paper_id: str
    query: str
    search_type: str
    results: List[PDFSearchResult]
    total_results: int


class PDFChatRequest(BaseModel):
    """Request for PDF-based chat."""
    paper_id: str
    message: str
    history: List[Dict[str, Any]] = Field(default_factory=list)
    max_context_tokens: int = Field(default=3000, ge=1000, le=8000)
