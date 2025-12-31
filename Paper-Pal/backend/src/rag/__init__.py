"""RAG (Retrieval-Augmented Generation) service for Paper Pal.

This module provides semantic search and context retrieval for PDF-based chat.
Requirements: 8.4, 8.5
"""

from .rag_service import RAGService
from .models import RAGContext, SearchResult

__all__ = ["RAGService", "RAGContext", "SearchResult"]