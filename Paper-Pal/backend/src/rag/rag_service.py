"""RAG service for text search and context retrieval.

Requirements: 8.4, 8.5
"""

import logging
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any

from .models import RAGContext, SearchResult
from ..pdf import PDFProcessor, TextStore, DocumentChunk

logger = logging.getLogger(__name__)


class RAGService:
    """Service for Retrieval-Augmented Generation with PDF documents using text search."""
    
    def __init__(self, 
                 text_store: Optional[TextStore] = None,
                 pdf_processor: Optional[PDFProcessor] = None):
        """Initialize RAG service.
        
        Args:
            text_store: Text store instance (creates new if None)
            pdf_processor: PDF processor instance (creates new if None)
        """
        self.text_store = text_store or TextStore()
        self.pdf_processor = pdf_processor or PDFProcessor()
        
        # Cache for RAG contexts
        self._contexts: Dict[str, RAGContext] = {}
        
        # Cache settings
        self.cache_ttl = timedelta(hours=1)  # Cache search results for 1 hour
    
    async def initialize_context(self, 
                                paper_id: str, 
                                paper_title: str, 
                                paper_abstract: str, 
                                pdf_url: str) -> RAGContext:
        """Initialize RAG context for a paper.
        
        Args:
            paper_id: Paper ID
            paper_title: Paper title
            paper_abstract: Paper abstract
            pdf_url: PDF URL for full-text processing
            
        Returns:
            RAGContext object
        """
        # Check if PDF is already processed
        is_pdf_processed = self.text_store.exists(paper_id)
        
        context = RAGContext(
            paper_id=paper_id,
            paper_title=paper_title,
            paper_abstract=paper_abstract,
            pdf_url=pdf_url,
            is_pdf_processed=is_pdf_processed
        )
        
        self._contexts[paper_id] = context
        logger.info(f"Initialized RAG context for paper {paper_id} (PDF processed: {is_pdf_processed})")
        
        return context
    
    async def process_pdf_if_needed(self, paper_id: str) -> bool:
        """Process PDF if not already processed.
        
        Args:
            paper_id: Paper ID
            
        Returns:
            True if processing was successful or already done, False otherwise
        """
        context = self._contexts.get(paper_id)
        if not context:
            logger.error(f"No context found for paper {paper_id}")
            return False
        
        if context.is_pdf_processed:
            logger.info(f"PDF already processed for paper {paper_id}")
            return True
        
        try:
            # Process PDF
            chunks = await self.pdf_processor.process_pdf(context.pdf_url, paper_id)
            
            # Store in text database
            self.text_store.store(paper_id, chunks)
            
            # Update context
            context.is_pdf_processed = True
            
            logger.info(f"Successfully processed PDF for paper {paper_id}: {len(chunks)} chunks")
            return True
            
        except Exception as e:
            logger.error(f"Failed to process PDF for paper {paper_id}: {e}")
            return False
    
    def search_semantic(self, 
                       paper_id: str, 
                       query: str, 
                       top_k: int = 5,
                       use_cache: bool = True) -> List[SearchResult]:
        """Perform text-based search on document chunks.
        
        Args:
            paper_id: Paper ID to search within
            query: Search query
            top_k: Number of top results to return
            use_cache: Whether to use cached results
            
        Returns:
            List of SearchResult objects ordered by relevance
        """
        context = self._contexts.get(paper_id)
        if not context:
            logger.error(f"No context found for paper {paper_id}")
            return []
        
        # Check cache if enabled
        if (use_cache and 
            context.last_query == query and 
            context.last_search_time and 
            datetime.now() - context.last_search_time < self.cache_ttl):
            
            logger.info(f"Using cached search results for paper {paper_id}")
            return [SearchResult(chunk=chunk, relevance_score=1.0) for chunk in context.retrieved_chunks]
        
        if not context.is_pdf_processed:
            logger.warning(f"PDF not processed for paper {paper_id}, cannot perform text search")
            return []
        
        try:
            # Perform text search
            chunks = self.text_store.search(paper_id, query, top_k)
            
            if not chunks:
                logger.info(f"No text search results for query '{query}' in paper {paper_id}")
                return []
            
            # Convert to SearchResult objects with decreasing relevance scores
            results = []
            for i, chunk in enumerate(chunks):
                # Assign decreasing relevance scores (most relevant first)
                relevance_score = max(0.1, 1.0 - (i * 0.15))
                results.append(SearchResult(chunk=chunk, relevance_score=relevance_score))
            
            # Update cache
            context.retrieved_chunks = chunks
            context.last_query = query
            context.last_search_time = datetime.now()
            
            logger.info(f"Found {len(results)} text search results for paper {paper_id}")
            return results
            
        except Exception as e:
            logger.error(f"Text search failed for paper {paper_id}: {e}")
            return []
    
    def search_keyword(self, 
                      paper_id: str, 
                      keywords: List[str], 
                      top_k: int = 5) -> List[SearchResult]:
        """Perform keyword-based search on document chunks.
        
        Args:
            paper_id: Paper ID to search within
            keywords: List of keywords to search for
            top_k: Number of top results to return
            
        Returns:
            List of SearchResult objects ordered by keyword match score
        """
        context = self._contexts.get(paper_id)
        if not context or not context.is_pdf_processed:
            logger.warning(f"Cannot perform keyword search for paper {paper_id} (not processed)")
            return []
        
        try:
            # Use text store's keyword search
            chunks = self.text_store.search_keywords(paper_id, keywords, top_k)
            
            if not chunks:
                logger.info(f"No keyword search results for paper {paper_id}")
                return []
            
            # Convert to SearchResult objects
            results = []
            for i, chunk in enumerate(chunks):
                # Assign decreasing relevance scores
                relevance_score = max(0.1, 1.0 - (i * 0.15))
                results.append(SearchResult(chunk=chunk, relevance_score=relevance_score))
            
            logger.info(f"Found {len(results)} keyword search results for paper {paper_id}")
            return results
            
        except Exception as e:
            logger.error(f"Keyword search failed for paper {paper_id}: {e}")
            return []
    
    def get_context(self, paper_id: str) -> Optional[RAGContext]:
        """Get RAG context for a paper.
        
        Args:
            paper_id: Paper ID
            
        Returns:
            RAGContext object or None if not found
        """
        return self._contexts.get(paper_id)
    
    def clear_context(self, paper_id: str) -> None:
        """Clear RAG context for a paper.
        
        Args:
            paper_id: Paper ID
        """
        if paper_id in self._contexts:
            del self._contexts[paper_id]
            logger.info(f"Cleared RAG context for paper {paper_id}")
    
    def get_processing_status(self, paper_id: str) -> Dict[str, Any]:
        """Get PDF processing status for a paper.
        
        Args:
            paper_id: Paper ID
            
        Returns:
            Dictionary with processing status information
        """
        status = self.pdf_processor.get_processing_status(paper_id)
        context = self._contexts.get(paper_id)
        
        return {
            "paper_id": paper_id,
            "is_downloading": status.is_downloading,
            "is_processing": status.is_processing,
            "is_complete": status.is_complete,
            "progress": status.progress,
            "error_message": status.error_message,
            "total_chunks": status.total_chunks,
            "processed_chunks": status.processed_chunks,
            "pdf_processed": context.is_pdf_processed if context else False,
            "has_context": context is not None
        }
    
    def get_stats(self) -> Dict[str, Any]:
        """Get RAG service statistics.
        
        Returns:
            Dictionary with service statistics
        """
        text_stats = self.text_store.get_stats()
        
        return {
            "active_contexts": len(self._contexts),
            "text_store": text_stats,
            "search_method": "keyword_and_text_search"
        }