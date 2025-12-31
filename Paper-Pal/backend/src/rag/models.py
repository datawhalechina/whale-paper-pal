"""RAG service data models.

Requirements: 8.4, 8.5
"""

from dataclasses import dataclass
from typing import List, Optional
from datetime import datetime

from ..pdf.models import DocumentChunk


@dataclass
class SearchResult:
    """Represents a search result with relevance score."""
    
    chunk: DocumentChunk
    relevance_score: float  # 0.0 to 1.0
    
    def __post_init__(self):
        """Validate search result data."""
        if not (0.0 <= self.relevance_score <= 1.0):
            raise ValueError("Relevance score must be between 0.0 and 1.0")


@dataclass
class RAGContext:
    """Represents the context for RAG-based conversation."""
    
    paper_id: str
    paper_title: str
    paper_abstract: str
    pdf_url: str
    is_pdf_processed: bool = False
    retrieved_chunks: List[DocumentChunk] = None
    last_query: Optional[str] = None
    last_search_time: Optional[datetime] = None
    
    def __post_init__(self):
        """Initialize default values."""
        if self.retrieved_chunks is None:
            self.retrieved_chunks = []
    
    def get_context_text(self, max_tokens: int = 3000) -> str:
        """Get formatted context text for LLM input.
        
        Args:
            max_tokens: Maximum tokens to include (rough estimate)
            
        Returns:
            Formatted context text
        """
        context_parts = []
        
        # Add paper metadata
        context_parts.append(f"论文标题: {self.paper_title}")
        context_parts.append(f"论文摘要: {self.paper_abstract}")
        
        # Add retrieved chunks if available
        if self.retrieved_chunks and self.is_pdf_processed:
            context_parts.append("\n相关PDF内容:")
            
            # Estimate tokens (rough: 1 token ≈ 4 characters)
            used_chars = sum(len(part) for part in context_parts)
            remaining_chars = (max_tokens - used_chars // 4) * 4
            
            for i, chunk in enumerate(self.retrieved_chunks):
                chunk_text = f"\n[第{chunk.page_number}页] {chunk.content}"
                
                if len(chunk_text) > remaining_chars:
                    # Truncate if too long
                    chunk_text = chunk_text[:remaining_chars] + "..."
                    context_parts.append(chunk_text)
                    break
                
                context_parts.append(chunk_text)
                remaining_chars -= len(chunk_text)
                
                if remaining_chars <= 0:
                    break
        
        return "\n".join(context_parts)
    
    def clear_search_cache(self):
        """Clear cached search results."""
        self.retrieved_chunks = []
        self.last_query = None
        self.last_search_time = None