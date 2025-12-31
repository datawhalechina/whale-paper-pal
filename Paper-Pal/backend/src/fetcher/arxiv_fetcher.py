"""ArXiv paper fetcher module."""

import arxiv
import os
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from ..models.paper import Paper


# Supported ArXiv categories for AI research
SUPPORTED_CATEGORIES = ["cs.AI", "cs.CL", "cs.CV", "cs.LG"]


class ArXivFetcher:
    """Fetches papers from ArXiv API."""
    
    def __init__(self, categories: Optional[List[str]] = None, http_proxy: Optional[str] = None, https_proxy: Optional[str] = None):

        """Initialize with target categories and proxy settings.
        
        Args:
            categories: List of ArXiv categories to fetch from.
                       Defaults to SUPPORTED_CATEGORIES.
            http_proxy: HTTP proxy URL (None to disable proxy)
            https_proxy: HTTPS proxy URL (None to disable proxy)
        """
        self.categories = categories or SUPPORTED_CATEGORIES
        
        # Handle proxy settings - clear if None, set if provided
        if http_proxy:
            os.environ['HTTP_PROXY'] = http_proxy
        else:
            os.environ.pop('HTTP_PROXY', None)
            
        if https_proxy:
            os.environ['HTTPS_PROXY'] = https_proxy
        else:
            os.environ.pop('HTTPS_PROXY', None)
        
        self._client = arxiv.Client()
    
    def fetch_recent(self, days: int = 1, max_results: int = 100) -> List[Paper]:
        """Fetch papers from the last N days.
        
        Args:
            days: Number of days to look back (default: 1)
            max_results: Maximum number of results to return (default: 100)
            
        Returns:
            List of Paper objects
        """
        # Build query for all categories
        category_query = " OR ".join([f"cat:{cat}" for cat in self.categories])
        
        # Create search with sorting by submission date
        search = arxiv.Search(
            query=category_query,
            max_results=max_results,
            sort_by=arxiv.SortCriterion.SubmittedDate,
            sort_order=arxiv.SortOrder.Descending
        )
        
        # Calculate cutoff date
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
        
        papers: List[Paper] = []
        
        for result in self._client.results(search):
            # Filter by date
            if result.published < cutoff_date:
                continue
            
            # Extract categories that match our supported list
            paper_categories = [
                cat for cat in result.categories 
                if cat in SUPPORTED_CATEGORIES
            ]
            
            # Skip if no matching categories
            if not paper_categories:
                continue
            
            paper = Paper(
                id=result.entry_id,
                title=result.title.strip().replace("\n", " "),
                abstract=result.summary.strip().replace("\n", " "),
                authors=[author.name for author in result.authors],
                categories=paper_categories,
                published=result.published,
                source="arxiv",
                url=result.entry_id
            )
            papers.append(paper)
        
        return papers
