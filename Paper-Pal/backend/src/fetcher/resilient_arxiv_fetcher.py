"""Resilient ArXiv fetcher with web scraping fallback."""

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import List, Optional
import requests
from bs4 import BeautifulSoup

# Import ArXivFetcher conditionally to avoid import errors
try:
    from .arxiv_fetcher import ArXivFetcher
    _ARXIV_FETCHER_AVAILABLE = True
except ImportError:
    _ARXIV_FETCHER_AVAILABLE = False

# Import Paper model conditionally
try:
    from ..models.paper import Paper
    _PAPER_MODEL_AVAILABLE = True
except ImportError:
    # Define a simple Paper class for standalone use
    class Paper:
        def __init__(self, id, title, abstract, authors, categories, published, source, url):
            self.id = id
            self.title = title
            self.abstract = abstract
            self.authors = authors
            self.categories = categories
            self.published = published
            self.source = source
            self.url = url
    _PAPER_MODEL_AVAILABLE = False

logger = logging.getLogger(__name__)


class ResilientArXivFetcher:
    """ArXiv fetcher with web scraping fallback for resilience."""
    
    def __init__(
        self, 
        categories: Optional[List[str]] = None,
        http_proxy: Optional[str] = None,
        https_proxy: Optional[str] = None,
        enable_web_fallback: bool = True,
        timeout: float = 30.0
    ):
        """Initialize resilient fetcher.
        
        Args:
            categories: List of ArXiv categories to fetch
            http_proxy: HTTP proxy URL
            https_proxy: HTTPS proxy URL
            enable_web_fallback: Whether to use web scraping as fallback
            timeout: Request timeout in seconds
        """
        self.categories = categories or ["cs.AI", "cs.CL", "cs.CV", "cs.LG"]
        self.enable_web_fallback = enable_web_fallback
        self.timeout = timeout
        
        # Initialize API fetcher if available
        if _ARXIV_FETCHER_AVAILABLE:
            self.api_fetcher = ArXivFetcher(
                categories=self.categories,
                http_proxy=http_proxy,
                https_proxy=https_proxy
            )
        else:
            self.api_fetcher = None
        
        # Setup web scraping session
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
    
    def fetch_recent(self, days: int = 1, max_results: int = 100) -> List[Paper]:
        """Fetch recent papers with fallback mechanism.
        
        Args:
            days: Number of days to look back
            max_results: Maximum number of papers to return
            
        Returns:
            List of Paper objects
        """
        # First, try the ArXiv API with retry
        if self.api_fetcher:
            try:
                logger.info("Attempting to fetch papers using ArXiv API...")
                papers = self._fetch_with_retry(days, max_results)
                
                if papers and len(papers) > 0:
                    logger.info(f"Successfully fetched {len(papers)} papers using ArXiv API")
                    return papers
                else:
                    logger.warning("ArXiv API returned 0 papers")
                    
            except Exception as e:
                logger.warning(f"ArXiv API failed: {e}")
        else:
            logger.warning("ArXiv API fetcher not available")
        
        # Fallback to web scraping if enabled
        if self.enable_web_fallback:
            try:
                logger.info("Attempting to fetch papers using web scraping fallback...")
                papers = self._fetch_with_web_scraping(days, max_results)
                
                if papers and len(papers) > 0:
                    logger.info(f"Successfully fetched {len(papers)} papers using web scraping")
                    return papers
                else:
                    logger.error("Web scraping also returned 0 papers")
                    
            except Exception as e:
                logger.error(f"Web scraping also failed: {e}")
        
        # Both methods failed
        logger.error("Both ArXiv API and web scraping failed")
        return []
    
    def _fetch_with_retry(self, days: int, max_results: int, max_retries: int = 3) -> List[Paper]:
        """Fetch papers using ArXiv API with retry logic.
        
        Args:
            days: Number of days to look back
            max_results: Maximum number of papers
            max_retries: Maximum number of retry attempts
            
        Returns:
            List of Paper objects
        """
        if not self.api_fetcher:
            raise Exception("ArXiv API fetcher not available")
            
        last_exception = None
        
        for attempt in range(max_retries + 1):
            try:
                logger.debug(f"API attempt {attempt + 1}/{max_retries + 1}")
                papers = self.api_fetcher.fetch_recent(days=days, max_results=max_results)
                
                if attempt > 0:
                    logger.info(f"API succeeded on attempt {attempt + 1}")
                
                return papers
                
            except Exception as e:
                last_exception = e
                logger.warning(f"API attempt {attempt + 1} failed: {e}")
                
                if attempt < max_retries:
                    delay = 2 ** attempt  # Exponential backoff: 1, 2, 4 seconds
                    logger.info(f"Retrying in {delay} seconds...")
                    time.sleep(delay)
                    continue
                break
        
        raise Exception(f"API failed after {max_retries + 1} attempts: {last_exception}")
    
    def _fetch_with_web_scraping(self, days: int, max_results: int) -> List[Paper]:
        """Fetch papers using web scraping.
        
        Args:
            days: Number of days to look back
            max_results: Maximum number of papers
            
        Returns:
            List of Paper objects
        """
        papers = []
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
        
        # Scrape each category
        for category in self.categories:
            try:
                category_papers = self._scrape_category(category, cutoff_date)
                papers.extend(category_papers)
                
                if len(papers) >= max_results:
                    break
                    
            except Exception as e:
                logger.warning(f"Failed to scrape category {category}: {e}")
                continue
        
        # Remove duplicates and limit results
        unique_papers = self._remove_duplicates(papers)
        return unique_papers[:max_results]
    
    def _scrape_category(self, category: str, cutoff_date: datetime) -> List[Paper]:
        """Scrape recent papers from a specific category.
        
        Args:
            category: ArXiv category (e.g., 'cs.AI')
            cutoff_date: Only include papers after this date
            
        Returns:
            List of Paper objects from this category
        """
        url = f"https://arxiv.org/list/{category}/recent"
        
        try:
            response = self.session.get(url, timeout=self.timeout)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            papers = []
            
            # Find paper entries
            paper_entries = soup.find_all('dt')
            
            for dt in paper_entries[:20]:  # Limit to first 20 entries per category
                try:
                    dd = dt.find_next_sibling('dd')
                    if not dd:
                        continue
                    
                    paper = self._parse_paper_entry(dt, dd, category)
                    if paper:
                        papers.append(paper)
                        
                except Exception as e:
                    logger.debug(f"Failed to parse paper entry: {e}")
                    continue
            
            logger.info(f"Scraped {len(papers)} papers from {category}")
            return papers
            
        except Exception as e:
            logger.error(f"Failed to scrape {category}: {e}")
            return []
    
    def _parse_paper_entry(self, dt_element, dd_element, category: str) -> Optional[Paper]:
        """Parse a single paper entry from ArXiv HTML.
        
        Args:
            dt_element: The dt element containing paper ID and links
            dd_element: The dd element containing paper details
            category: The category this paper belongs to
            
        Returns:
            Paper object or None if parsing fails
        """
        try:
            # Extract paper ID
            arxiv_id = None
            links = dt_element.find_all('a')
            for link in links:
                href = link.get('href', '')
                if '/abs/' in href:
                    arxiv_id = href.split('/abs/')[-1]
                    break
            
            if not arxiv_id:
                return None
            
            # Extract title
            title_div = dd_element.find('div', class_='list-title')
            if not title_div:
                return None
            
            title = title_div.get_text().replace('Title:', '').strip()
            
            # Extract authors
            authors_div = dd_element.find('div', class_='list-authors')
            authors = []
            if authors_div:
                author_links = authors_div.find_all('a')
                authors = [link.get_text().strip() for link in author_links]
            
            # Extract abstract
            abstract_div = dd_element.find('p', class_='mathjax')
            abstract = ""
            if abstract_div:
                abstract = abstract_div.get_text().strip()
            
            # Use current time as published date (limitation of web scraping)
            published = datetime.now(timezone.utc)
            
            paper = Paper(
                id=f"https://arxiv.org/abs/{arxiv_id}",
                title=title,
                abstract=abstract,
                authors=authors,
                categories=[category],
                published=published,
                source="arxiv_web",
                url=f"https://arxiv.org/abs/{arxiv_id}"
            )
            
            return paper
            
        except Exception as e:
            logger.debug(f"Failed to parse paper entry: {e}")
            return None
    
    def _remove_duplicates(self, papers: List[Paper]) -> List[Paper]:
        """Remove duplicate papers based on ID."""
        seen_ids = set()
        unique_papers = []
        
        for paper in papers:
            if paper.id not in seen_ids:
                seen_ids.add(paper.id)
                unique_papers.append(paper)
        
        return unique_papers