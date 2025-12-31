"""Enhanced ArXiv fetcher with web scraping fallback."""

import logging
from typing import List, Optional

from ..config import NetworkConfig
from ..models.paper import Paper
from .base_fetcher import FetchResult, FetchMethod
from .arxiv_fetcher import ArXivFetcher
from .arxiv_web_scraper import ArXivWebScraper
from .retry_handler import RetryHandler
from .exceptions import ArXivAPIError, WebScrapingError

logger = logging.getLogger(__name__)


class EnhancedArXivFetcher:
    """Enhanced ArXiv fetcher with fallback mechanisms."""
    
    def __init__(
        self, 
        categories: Optional[List[str]] = None,
        http_proxy: Optional[str] = None,
        https_proxy: Optional[str] = None,
        network_config: Optional[NetworkConfig] = None
    ):
        """Initialize enhanced fetcher.
        
        Args:
            categories: List of ArXiv categories to fetch
            http_proxy: HTTP proxy URL
            https_proxy: HTTPS proxy URL
            network_config: Network configuration for retry and fallback
        """
        self.categories = categories or ["cs.AI", "cs.CL", "cs.CV", "cs.LG"]
        self.network_config = network_config or NetworkConfig()
        
        # Initialize components
        self.api_fetcher = ArXivFetcher(
            categories=self.categories,
            http_proxy=http_proxy,
            https_proxy=https_proxy
        )
        
        self.web_scraper = ArXivWebScraper(timeout=self.network_config.request_timeout)
        self.retry_handler = RetryHandler(self.network_config)
    
    async def fetch_papers(self, days: int = 1, max_results: int = 100) -> FetchResult:
        """Fetch papers using API with web scraping fallback.
        
        Args:
            days: Number of days to look back
            max_results: Maximum number of papers to return
            
        Returns:
            FetchResult containing papers and metadata
        """
        # First, try the ArXiv API
        try:
            logger.info("Attempting to fetch papers using ArXiv API...")
            
            papers = await self.retry_handler.execute_with_retry(
                self._fetch_with_api,
                days=days,
                max_results=max_results
            )
            
            # Check if we got meaningful results
            if papers and len(papers) > 0:
                logger.info(f"Successfully fetched {len(papers)} papers using ArXiv API")
                return FetchResult(
                    papers=papers,
                    method=FetchMethod.ARXIV_API,
                    success=True
                )
            else:
                logger.warning("ArXiv API returned 0 papers, trying web scraping fallback...")
                
        except Exception as e:
            logger.warning(f"ArXiv API failed: {e}, trying web scraping fallback...")
        
        # Fallback to web scraping if enabled
        if self.network_config.enable_web_fallback:
            try:
                logger.info("Attempting to fetch papers using web scraping...")
                
                papers = await self.retry_handler.execute_with_retry(
                    self._fetch_with_web_scraping,
                    days=days,
                    max_results=max_results
                )
                
                if papers and len(papers) > 0:
                    logger.info(f"Successfully fetched {len(papers)} papers using web scraping")
                    return FetchResult(
                        papers=papers,
                        method=FetchMethod.WEB_SCRAPING,
                        success=True
                    )
                else:
                    logger.error("Web scraping also returned 0 papers")
                    
            except Exception as e:
                logger.error(f"Web scraping also failed: {e}")
                return FetchResult(
                    papers=[],
                    method=FetchMethod.WEB_SCRAPING,
                    success=False,
                    error_message=f"Both API and web scraping failed. Last error: {e}"
                )
        
        # Both methods failed or web fallback is disabled
        return FetchResult(
            papers=[],
            method=FetchMethod.ARXIV_API,
            success=False,
            error_message="ArXiv API failed and web fallback is disabled or also failed"
        )
    
    async def _fetch_with_api(self, days: int, max_results: int) -> List[Paper]:
        """Fetch papers using ArXiv API.
        
        Args:
            days: Number of days to look back
            max_results: Maximum number of papers
            
        Returns:
            List of Paper objects
            
        Raises:
            ArXivAPIError: When API fetch fails
        """
        try:
            # Use sync method since ArXivFetcher is synchronous
            papers = self.api_fetcher.fetch_recent(days=days, max_results=max_results)
            return papers
            
        except Exception as e:
            logger.error(f"ArXiv API fetch failed: {e}")
            raise ArXivAPIError(f"ArXiv API fetch failed: {e}")
    
    async def _fetch_with_web_scraping(self, days: int, max_results: int) -> List[Paper]:
        """Fetch papers using web scraping.
        
        Args:
            days: Number of days to look back
            max_results: Maximum number of papers
            
        Returns:
            List of Paper objects
            
        Raises:
            WebScrapingError: When web scraping fails
        """
        try:
            # Web scraper is synchronous, so we call it directly
            papers = self.web_scraper.scrape_recent_papers(
                categories=self.categories,
                days=days,
                max_results=max_results
            )
            return papers
            
        except Exception as e:
            logger.error(f"Web scraping failed: {e}")
            raise WebScrapingError(f"Web scraping failed: {e}")
    
    def fetch_papers_sync(self, days: int = 1, max_results: int = 100) -> FetchResult:
        """Synchronous version of fetch_papers for compatibility.
        
        Args:
            days: Number of days to look back
            max_results: Maximum number of papers to return
            
        Returns:
            FetchResult containing papers and metadata
        """
        # First, try the ArXiv API
        try:
            logger.info("Attempting to fetch papers using ArXiv API (sync)...")
            
            papers = self.retry_handler.execute_sync_with_retry(
                self.api_fetcher.fetch_recent,
                days=days,
                max_results=max_results
            )
            
            # Check if we got meaningful results
            if papers and len(papers) > 0:
                logger.info(f"Successfully fetched {len(papers)} papers using ArXiv API (sync)")
                return FetchResult(
                    papers=papers,
                    method=FetchMethod.ARXIV_API,
                    success=True
                )
            else:
                logger.warning("ArXiv API returned 0 papers, trying web scraping fallback (sync)...")
                
        except Exception as e:
            logger.warning(f"ArXiv API failed (sync): {e}, trying web scraping fallback...")
        
        # Fallback to web scraping if enabled
        if self.network_config.enable_web_fallback:
            try:
                logger.info("Attempting to fetch papers using web scraping (sync)...")
                
                papers = self.retry_handler.execute_sync_with_retry(
                    self.web_scraper.scrape_recent_papers,
                    categories=self.categories,
                    days=days,
                    max_results=max_results
                )
                
                if papers and len(papers) > 0:
                    logger.info(f"Successfully fetched {len(papers)} papers using web scraping (sync)")
                    return FetchResult(
                        papers=papers,
                        method=FetchMethod.WEB_SCRAPING,
                        success=True
                    )
                else:
                    logger.error("Web scraping also returned 0 papers (sync)")
                    
            except Exception as e:
                logger.error(f"Web scraping also failed (sync): {e}")
                return FetchResult(
                    papers=[],
                    method=FetchMethod.WEB_SCRAPING,
                    success=False,
                    error_message=f"Both API and web scraping failed. Last error: {e}"
                )
        
        # Both methods failed or web fallback is disabled
        return FetchResult(
            papers=[],
            method=FetchMethod.ARXIV_API,
            success=False,
            error_message="ArXiv API failed and web fallback is disabled or also failed"
        )