"""Hugging Face Daily Papers fetcher module."""

import httpx
from datetime import datetime, timezone
from typing import List, Optional, Any, Dict

from ..models.paper import Paper


# Hugging Face Daily Papers API endpoint
HF_DAILY_PAPERS_URL = "https://huggingface.co/api/daily_papers"


class HuggingFaceFetcher:
    """Fetches papers from Hugging Face Daily Papers."""
    
    def __init__(self, timeout: float = 30.0):
        """Initialize the fetcher.
        
        Args:
            timeout: HTTP request timeout in seconds (default: 30.0)
        """
        self._timeout = timeout
    
    def fetch_daily(self) -> List[Paper]:
        """Fetch today's daily papers from Hugging Face.
        
        Returns:
            List of Paper objects with popularity signals
        """
        try:
            with httpx.Client(timeout=self._timeout) as client:
                response = client.get(HF_DAILY_PAPERS_URL)
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPError:
            return []
        
        papers: List[Paper] = []
        
        for item in data:
            paper = self._parse_paper(item)
            if paper:
                papers.append(paper)
        
        return papers
    
    def _parse_paper(self, item: Dict[str, Any]) -> Optional[Paper]:
        """Parse a single paper from HF API response.
        
        Args:
            item: Raw paper data from API
            
        Returns:
            Paper object or None if parsing fails
        """
        try:
            paper_data = item.get("paper", {})
            
            # Extract paper ID (arxiv ID if available)
            paper_id = paper_data.get("id", "")
            
            # Extract title
            title = paper_data.get("title", "").strip()
            if not title:
                return None
            
            # Extract abstract/summary
            abstract = paper_data.get("summary", "").strip()
            if not abstract:
                return None
            
            # Extract authors
            authors_data = paper_data.get("authors", [])
            authors = [
                author.get("name", "") 
                for author in authors_data 
                if author.get("name")
            ]
            
            # Published date - use publishedAt or current time
            published_str = paper_data.get("publishedAt")
            if published_str:
                try:
                    published = datetime.fromisoformat(
                        published_str.replace("Z", "+00:00")
                    )
                except ValueError:
                    published = datetime.now(timezone.utc)
            else:
                published = datetime.now(timezone.utc)
            
            # Build URL - HF papers link to arxiv
            arxiv_id = paper_id.split("/")[-1] if "/" in paper_id else paper_id
            url = f"https://arxiv.org/abs/{arxiv_id}" if arxiv_id else ""
            
            return Paper(
                id=paper_id,
                title=title,
                abstract=abstract,
                authors=authors,
                categories=["huggingface-daily"],  # Mark as HF source
                published=published,
                source="huggingface",
                url=url
            )
        except (KeyError, TypeError):
            return None
