"""Text-based storage for PDF document chunks using keyword search.

Requirements: 8.3, 8.4
"""

import json
import logging
import re
from pathlib import Path
from typing import List, Optional, Dict, Any
from collections import defaultdict

from .models import DocumentChunk

logger = logging.getLogger(__name__)


class TextStore:
    """Local text database for storing and retrieving document chunks using keyword search."""
    
    def __init__(self, persist_directory: str = "data/text_db"):
        """Initialize text store with JSON-based persistence.
        
        Args:
            persist_directory: Directory to persist the text database
        """
        self.persist_directory = Path(persist_directory)
        self.persist_directory.mkdir(parents=True, exist_ok=True)
        
        # In-memory storage for fast access
        self._chunks: Dict[str, List[DocumentChunk]] = {}
        
        # Load existing data
        self._load_from_disk()
        
        logger.info(f"Text store initialized at {self.persist_directory}")
    
    def _get_storage_path(self, paper_id: str) -> Path:
        """Get storage file path for a paper."""
        # Clean paper_id to make it a valid filename
        # Replace invalid characters with underscores
        clean_paper_id = re.sub(r'[<>:"/\\|?*]', '_', paper_id)
        # Also replace dots with underscores to avoid confusion with file extensions
        clean_paper_id = clean_paper_id.replace('.', '_')
        return self.persist_directory / f"{clean_paper_id}.json"
    
    def _load_from_disk(self):
        """Load all stored chunks from disk."""
        try:
            for json_file in self.persist_directory.glob("*.json"):
                paper_id = json_file.stem
                with open(json_file, 'r', encoding='utf-8') as f:
                    chunks_data = json.load(f)
                
                chunks = []
                for chunk_data in chunks_data:
                    chunk = DocumentChunk(
                        id=chunk_data['id'],
                        paper_id=chunk_data['paper_id'],
                        chunk_index=chunk_data['chunk_index'],
                        content=chunk_data['content'],
                        page_number=chunk_data['page_number'],
                        embedding=None  # No embeddings for text search
                    )
                    chunks.append(chunk)
                
                self._chunks[paper_id] = chunks
                logger.info(f"Loaded {len(chunks)} chunks for paper {paper_id}")
                
        except Exception as e:
            logger.error(f"Failed to load chunks from disk: {e}")
    
    def _save_to_disk(self, paper_id: str):
        """Save chunks for a paper to disk."""
        try:
            chunks = self._chunks.get(paper_id, [])
            chunks_data = []
            
            for chunk in chunks:
                chunks_data.append({
                    'id': chunk.id,
                    'paper_id': chunk.paper_id,
                    'chunk_index': chunk.chunk_index,
                    'content': chunk.content,
                    'page_number': chunk.page_number
                })
            
            storage_path = self._get_storage_path(paper_id)
            with open(storage_path, 'w', encoding='utf-8') as f:
                json.dump(chunks_data, f, ensure_ascii=False, indent=2)
                
            logger.info(f"Saved {len(chunks)} chunks for paper {paper_id}")
            
        except Exception as e:
            logger.error(f"Failed to save chunks for paper {paper_id}: {e}")
            raise
    
    def store(self, paper_id: str, chunks: List[DocumentChunk]) -> None:
        """Store document chunks in the text database.
        
        Args:
            paper_id: Paper ID
            chunks: List of DocumentChunk objects
        """
        if not chunks:
            logger.warning(f"No chunks to store for paper {paper_id}")
            return
        
        try:
            # Store in memory
            self._chunks[paper_id] = chunks
            
            # Persist to disk
            self._save_to_disk(paper_id)
            
            logger.info(f"Stored {len(chunks)} chunks for paper {paper_id}")
            
        except Exception as e:
            logger.error(f"Failed to store chunks for paper {paper_id}: {e}")
            raise
    
    def search(self, paper_id: str, query: str, top_k: int = 5) -> List[DocumentChunk]:
        """Search for relevant document chunks using keyword matching.
        
        Args:
            paper_id: Paper ID to search within
            query: Search query text
            top_k: Number of top results to return
            
        Returns:
            List of DocumentChunk objects ordered by relevance
        """
        try:
            chunks = self._chunks.get(paper_id, [])
            if not chunks:
                logger.info(f"No chunks found for paper {paper_id}")
                return []
            
            # Prepare query terms
            query_terms = self._extract_keywords(query.lower())
            
            # Add common section keywords based on query intent
            query_lower = query.lower()
            section_keywords = []
            
            # Map Chinese queries to English section keywords
            if any(word in query_lower for word in ['引言', '介绍', '导言']):
                section_keywords.extend(['introduction', 'intro', 'background'])
            if any(word in query_lower for word in ['方法', '方法论', '算法']):
                section_keywords.extend(['method', 'methodology', 'algorithm', 'approach'])
            if any(word in query_lower for word in ['实验', '结果', '评估']):
                section_keywords.extend(['experiment', 'result', 'evaluation', 'performance'])
            if any(word in query_lower for word in ['结论', '总结', '讨论']):
                section_keywords.extend(['conclusion', 'discussion', 'summary'])
            if any(word in query_lower for word in ['相关工作', '背景']):
                section_keywords.extend(['related work', 'background', 'literature'])
            
            # Combine original query terms with section keywords
            all_terms = query_terms + section_keywords
            
            if not all_terms:
                # Fallback: use simple substring search
                scored_chunks = []
                for chunk in chunks:
                    if query.lower() in chunk.content.lower():
                        scored_chunks.append((chunk, 1.0))
                
                if scored_chunks:
                    result_chunks = [chunk for chunk, score in scored_chunks[:top_k]]
                    logger.info(f"Found {len(result_chunks)} substring matches for query in paper {paper_id}")
                    return result_chunks
                
                return []
            
            # Score chunks based on keyword matches
            scored_chunks = []
            for chunk in chunks:
                score = self._calculate_bm25_score(chunk.content.lower(), all_terms)
                if score > 0:
                    scored_chunks.append((chunk, score))
            
            # Sort by score and return top_k
            scored_chunks.sort(key=lambda x: x[1], reverse=True)
            result_chunks = [chunk for chunk, score in scored_chunks[:top_k]]
            
            logger.info(f"Found {len(result_chunks)} relevant chunks for query in paper {paper_id}")
            return result_chunks
            
        except Exception as e:
            logger.error(f"Failed to search chunks for paper {paper_id}: {e}")
            return []
    
    def search_keywords(self, paper_id: str, keywords: List[str], top_k: int = 5) -> List[DocumentChunk]:
        """Search for chunks containing specific keywords.
        
        Args:
            paper_id: Paper ID to search within
            keywords: List of keywords to search for
            top_k: Number of top results to return
            
        Returns:
            List of DocumentChunk objects ordered by keyword match count
        """
        try:
            chunks = self._chunks.get(paper_id, [])
            if not chunks:
                return []
            
            # Score chunks based on keyword matches
            scored_chunks = []
            for chunk in chunks:
                content_lower = chunk.content.lower()
                score = 0
                
                for keyword in keywords:
                    keyword_lower = keyword.lower()
                    
                    # For English words, use word boundaries
                    if re.match(r'^[a-zA-Z]+$', keyword_lower):
                        occurrences = len(re.findall(r'\b' + re.escape(keyword_lower) + r'\b', content_lower))
                    else:
                        # For Chinese or mixed text, use simple substring matching
                        occurrences = content_lower.count(keyword_lower)
                    
                    score += occurrences
                
                if score > 0:
                    scored_chunks.append((chunk, score))
            
            # Sort by score and return top_k
            scored_chunks.sort(key=lambda x: x[1], reverse=True)
            result_chunks = [chunk for chunk, score in scored_chunks[:top_k]]
            
            logger.info(f"Found {len(result_chunks)} keyword matches for paper {paper_id}")
            return result_chunks
            
        except Exception as e:
            logger.error(f"Failed to search keywords for paper {paper_id}: {e}")
            return []
    
    def _extract_keywords(self, text: str) -> List[str]:
        """Extract meaningful keywords from text, supporting both English and Chinese."""
        # Handle Chinese and English text differently
        keywords = []
        
        # For Chinese text: extract individual characters and common terms
        chinese_chars = re.findall(r'[\u4e00-\u9fff]+', text)
        for chinese_text in chinese_chars:
            # Add individual Chinese characters (for basic matching)
            keywords.extend(list(chinese_text))
            # Add 2-character combinations (common Chinese word patterns)
            for i in range(len(chinese_text) - 1):
                keywords.append(chinese_text[i:i+2])
            # Add 3-character combinations for more complex terms
            for i in range(len(chinese_text) - 2):
                keywords.append(chinese_text[i:i+3])
        
        # For English text: use word boundaries
        english_words = re.findall(r'\b[a-zA-Z]+\b', text)
        
        # Filter out common English stop words and short words
        stop_words = {
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
            'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did',
            'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those'
        }
        
        english_keywords = [word for word in english_words if len(word) > 2 and word.lower() not in stop_words]
        keywords.extend(english_keywords)
        
        # Remove duplicates while preserving order
        seen = set()
        unique_keywords = []
        for keyword in keywords:
            if keyword not in seen:
                seen.add(keyword)
                unique_keywords.append(keyword)
        
        return unique_keywords
    
    def _calculate_bm25_score(self, content: str, query_terms: List[str]) -> float:
        """Calculate simplified BM25-like score for content relevance, supporting Chinese and English."""
        if not query_terms:
            return 0.0
        
        # Extract all possible terms from content (both Chinese and English)
        content_terms = self._extract_keywords(content)
        content_length = len(content_terms)
        
        if content_length == 0:
            return 0.0
        
        score = 0.0
        for term in query_terms:
            # Count term frequency (exact matches)
            tf = content_terms.count(term)
            
            # Also check for substring matches in content (important for Chinese)
            if tf == 0 and len(term) > 1:
                # Count how many times this term appears as substring
                tf = content.count(term)
            
            if tf > 0:
                # Simple TF scoring with length normalization
                score += tf / (tf + 1.0) * (1.0 / (content_length / 100.0 + 1.0))
        
        return score
    
    def exists(self, paper_id: str) -> bool:
        """Check if chunks exist for a paper.
        
        Args:
            paper_id: Paper ID to check
            
        Returns:
            True if chunks exist, False otherwise
        """
        return paper_id in self._chunks and len(self._chunks[paper_id]) > 0
    
    def delete(self, paper_id: str) -> None:
        """Delete all chunks for a paper.
        
        Args:
            paper_id: Paper ID to delete chunks for
        """
        try:
            # Remove from memory
            if paper_id in self._chunks:
                chunk_count = len(self._chunks[paper_id])
                del self._chunks[paper_id]
                logger.info(f"Deleted {chunk_count} chunks for paper {paper_id}")
            
            # Remove from disk
            storage_path = self._get_storage_path(paper_id)
            if storage_path.exists():
                storage_path.unlink()
                
        except Exception as e:
            logger.error(f"Failed to delete chunks for paper {paper_id}: {e}")
            raise
    
    def get_stats(self) -> dict:
        """Get text store statistics.
        
        Returns:
            Dictionary with store statistics
        """
        try:
            total_chunks = sum(len(chunks) for chunks in self._chunks.values())
            return {
                "total_papers": len(self._chunks),
                "total_chunks": total_chunks,
                "persist_directory": str(self.persist_directory)
            }
        except Exception as e:
            logger.error(f"Failed to get text store stats: {e}")
            return {"total_papers": 0, "total_chunks": 0, "persist_directory": str(self.persist_directory)}
    
    def reset(self) -> None:
        """Reset the text store (delete all data).
        
        Warning: This will delete all stored chunks!
        """
        try:
            # Clear memory
            self._chunks.clear()
            
            # Remove all JSON files
            for json_file in self.persist_directory.glob("*.json"):
                json_file.unlink()
            
            logger.warning("Text store has been reset - all data deleted")
            
        except Exception as e:
            logger.error(f"Failed to reset text store: {e}")
            raise


# Backward compatibility alias
VectorStore = TextStore