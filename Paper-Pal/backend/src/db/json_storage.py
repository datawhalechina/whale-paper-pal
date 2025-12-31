"""JSON file-based storage for Paper Pal.

Simple file-based storage using JSON files instead of database.
"""

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional


# Default data directory
DATA_DIR = Path(__file__).parent.parent.parent / "data"

# Simple thread lock for file operations
_file_lock = threading.Lock()


class JsonStorage:
    """JSON file-based storage for papers and user data."""
    
    def __init__(self, data_dir: Optional[str] = None):
        """Initialize JSON storage.
        
        Args:
            data_dir: Directory to store JSON files (default: backend/data)
        """
        self._data_dir = Path(data_dir) if data_dir else DATA_DIR
        self._data_dir.mkdir(parents=True, exist_ok=True)
        
        # File paths
        self._papers_file = self._data_dir / "papers.json"
        self._saved_papers_file = self._data_dir / "saved_papers.json"
        self._config_file = self._data_dir / "config.json"
        
        # Initialize files if they don't exist
        self._init_files()
    
    def _init_files(self):
        """Initialize JSON files if they don't exist."""
        if not self._papers_file.exists():
            self._write_json(self._papers_file, [])
        if not self._saved_papers_file.exists():
            self._write_json(self._saved_papers_file, [])
        if not self._config_file.exists():
            self._write_json(self._config_file, {})
    
    def _read_json(self, file_path: Path) -> any:
        """Read JSON file with thread locking."""
        with _file_lock:
            if file_path.exists():
                with open(file_path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            return None
    
    def _write_json(self, file_path: Path, data: any):
        """Write JSON file with thread locking."""
        with _file_lock:
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
    
    # Papers operations
    def insert_paper(self, paper_data: dict) -> dict:
        """Insert a paper into storage."""
        papers = self._read_json(self._papers_file) or []
        
        # Add timestamp if not present
        if 'created_at' not in paper_data:
            paper_data['created_at'] = datetime.now(timezone.utc).isoformat()
        
        papers.append(paper_data)
        self._write_json(self._papers_file, papers)
        return paper_data
    
    def upsert_paper(self, paper_data: dict) -> dict:
        """Insert or update a paper in storage.
        
        Uses arxiv_id as the unique key for upsert.
        """
        papers = self._read_json(self._papers_file) or []
        arxiv_id = paper_data.get('arxiv_id')
        
        # Find existing paper
        existing_idx = None
        for i, p in enumerate(papers):
            if p.get('arxiv_id') == arxiv_id:
                existing_idx = i
                break
        
        # Add/update timestamp
        paper_data['updated_at'] = datetime.now(timezone.utc).isoformat()
        if 'created_at' not in paper_data:
            paper_data['created_at'] = paper_data['updated_at']
        
        if existing_idx is not None:
            # Update existing
            papers[existing_idx] = paper_data
        else:
            # Insert new
            papers.append(paper_data)
        
        self._write_json(self._papers_file, papers)
        return paper_data
    
    def get_papers(
        self,
        limit: int = 50,
        offset: int = 0,
        min_score: Optional[float] = None
    ) -> List[dict]:
        """Get papers from storage.
        
        Args:
            limit: Maximum number of papers to return
            offset: Number of papers to skip
            min_score: Minimum total score filter
            
        Returns:
            List of paper dictionaries
        """
        papers = self._read_json(self._papers_file) or []
        
        # Filter by min_score if specified
        if min_score is not None:
            papers = [p for p in papers if (p.get('total_score') or 0) >= min_score]
        
        # Sort by total_score descending
        papers.sort(key=lambda x: x.get('total_score') or 0, reverse=True)
        
        # Apply pagination
        return papers[offset:offset + limit]
    
    def get_paper_by_id(self, paper_id: str) -> Optional[dict]:
        """Get a paper by its ID (arxiv_id).
        
        Args:
            paper_id: The paper's arxiv_id
            
        Returns:
            Paper dictionary or None if not found
        """
        papers = self._read_json(self._papers_file) or []
        
        for paper in papers:
            if paper.get('arxiv_id') == paper_id or paper.get('id') == paper_id:
                return paper
        
        return None
    
    def get_scored_papers(self, min_score: float = 0.0, limit: int = 50) -> List[dict]:
        """Get scored papers above a minimum score threshold."""
        return self.get_papers(limit=limit, min_score=min_score)
    
    def get_paper_by_arxiv_id(self, arxiv_id: str) -> Optional[dict]:
        """Get a paper by its ArXiv ID."""
        return self.get_paper_by_id(arxiv_id)
    
    # Saved papers operations
    def save_paper(self, user_id: str, paper_id: str) -> dict:
        """Save a paper for later reading."""
        saved = self._read_json(self._saved_papers_file) or []
        
        # Check if already saved
        for s in saved:
            if s.get('user_id') == user_id and s.get('paper_id') == paper_id:
                return {**s, 'already_saved': True}  # Mark as already saved
        
        entry = {
            'user_id': user_id,
            'paper_id': paper_id,
            'saved_at': datetime.now(timezone.utc).isoformat(),
            'already_saved': False
        }
        saved.append(entry)
        self._write_json(self._saved_papers_file, saved)
        return entry
    
    def save_paper_for_later(self, paper_id: str, user_id: str = "default") -> dict:
        """Save a paper for later reading."""
        return self.save_paper(user_id, paper_id)
    
    def get_saved_papers(self, user_id: str) -> List[dict]:
        """Get saved papers for a user."""
        saved = self._read_json(self._saved_papers_file) or []
        papers = self._read_json(self._papers_file) or []
        
        # Filter by user_id and join with paper data
        result = []
        for s in saved:
            if s.get('user_id') == user_id:
                paper_id = s.get('paper_id')
                
                # Try to find paper by multiple ID fields
                paper = None
                for p in papers:
                    if (p.get('arxiv_id') == paper_id or 
                        p.get('id') == paper_id or
                        p.get('paper_id') == paper_id):
                        paper = p
                        break
                
                if paper:
                    result.append({**s, 'paper': paper})
                else:
                    # Include saved entry even if paper not found
                    result.append(s)
        
        # Sort by saved_at timestamp in descending order (newest first)
        result.sort(key=lambda x: x.get('saved_at', ''), reverse=True)
        
        return result
    
    def remove_saved_paper(self, user_id: str, paper_id: str) -> bool:
        """Remove a saved paper for a user.
        
        Args:
            user_id: The user ID
            paper_id: The paper ID to remove
            
        Returns:
            True if paper was removed, False if not found
        """
        saved = self._read_json(self._saved_papers_file) or []
        
        # Find and remove the saved paper
        original_length = len(saved)
        saved = [s for s in saved if not (s.get('user_id') == user_id and s.get('paper_id') == paper_id)]
        
        if len(saved) < original_length:
            self._write_json(self._saved_papers_file, saved)
            return True
        
        return False
    
    # Config operations
    def get_user_config(self, user_id: str) -> Optional[dict]:
        """Get user configuration."""
        configs = self._read_json(self._config_file) or {}
        return configs.get(user_id)
    
    def upsert_user_config(self, user_id: str, interests: list, threshold: float) -> dict:
        """Update or insert user configuration."""
        configs = self._read_json(self._config_file) or {}
        configs[user_id] = {
            'user_id': user_id,
            'interests': interests,
            'threshold': threshold,
            'updated_at': datetime.now(timezone.utc).isoformat()
        }
        self._write_json(self._config_file, configs)
        return configs[user_id]
    
    # Utility methods
    def clear_all(self):
        """Clear all data (for testing)."""
        self._write_json(self._papers_file, [])
        self._write_json(self._saved_papers_file, [])
        self._write_json(self._config_file, {})
    
    def get_stats(self) -> dict:
        """Get storage statistics."""
        papers = self._read_json(self._papers_file) or []
        saved = self._read_json(self._saved_papers_file) or []
        
        scored_papers = [p for p in papers if p.get('total_score') is not None]
        
        return {
            'total_papers': len(papers),
            'scored_papers': len(scored_papers),
            'saved_papers': len(saved),
            'data_dir': str(self._data_dir)
        }


# Singleton instance
_storage: Optional[JsonStorage] = None


def get_json_storage(data_dir: Optional[str] = None) -> JsonStorage:
    """Get or create the JSON storage singleton."""
    global _storage
    
    if _storage is None:
        _storage = JsonStorage(data_dir)
    
    return _storage
