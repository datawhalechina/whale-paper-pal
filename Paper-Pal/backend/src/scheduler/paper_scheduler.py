"""Paper fetching and scoring scheduler."""

import asyncio
import logging
from datetime import datetime, timezone
from typing import List, Optional, Callable

from ..config import load_config
from ..scorer import LLMScorer, scored_paper_to_db_dict
from ..db import get_json_storage
from ..models import Paper, ScoredPaper

# Set up logger first
logger = logging.getLogger(__name__)

# Try to import resilient fetcher first, then enhanced, then regular
_RESILIENT_FETCHER_AVAILABLE = False
_ENHANCED_FETCHER_AVAILABLE = False
_REGULAR_FETCHER_AVAILABLE = False

try:
    from ..fetcher.resilient_arxiv_fetcher import ResilientArXivFetcher
    _RESILIENT_FETCHER_AVAILABLE = True
    logger.info("ResilientArXivFetcher imported successfully")
except ImportError as e:
    logger.warning(f"ResilientArXivFetcher import failed: {e}")

try:
    from ..fetcher import EnhancedArXivFetcher
    _ENHANCED_FETCHER_AVAILABLE = True
    logger.info("EnhancedArXivFetcher imported successfully")
except ImportError as e:
    logger.warning(f"EnhancedArXivFetcher import failed: {e}")

try:
    from ..fetcher import ArXivFetcher
    _REGULAR_FETCHER_AVAILABLE = True
    logger.info("ArXivFetcher imported successfully")
except ImportError as e:
    logger.warning(f"ArXivFetcher import failed: {e}")

# Log the final status
logger.info(f"Fetcher availability - Resilient: {_RESILIENT_FETCHER_AVAILABLE}, Enhanced: {_ENHANCED_FETCHER_AVAILABLE}, Regular: {_REGULAR_FETCHER_AVAILABLE}")


class PaperScheduler:
    """Background scheduler for fetching and scoring papers."""
    
    def __init__(self):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._on_high_score_papers: Optional[Callable[[List[ScoredPaper]], None]] = None
        self._last_fetch_time: Optional[datetime] = None
        self._fetch_count = 0
    
    def set_notification_callback(self, callback: Callable[[List[ScoredPaper]], None]):
        """Set callback for when high-score papers are found."""
        self._on_high_score_papers = callback
    
    @property
    def is_running(self) -> bool:
        return self._running
    
    @property
    def last_fetch_time(self) -> Optional[datetime]:
        return self._last_fetch_time
    
    @property
    def fetch_count(self) -> int:
        return self._fetch_count
    
    async def fetch_and_score_papers(self) -> List[ScoredPaper]:
        """Fetch papers from ArXiv and score them with LLM.
        
        Only scores NEW papers (not already in storage) to save API calls.
        
        Returns:
            List of high-score papers (above threshold)
        """
        config = load_config()
        storage = get_json_storage()
        
        logger.info("Starting paper fetch and score...")
        
        # Fetch papers using the best available fetcher
        try:
            if _RESILIENT_FETCHER_AVAILABLE:
                logger.info("Using resilient ArXiv fetcher with web scraping fallback")
                fetcher = ResilientArXivFetcher(
                    categories=config.arxiv_categories,
                    http_proxy=config.http_proxy,
                    https_proxy=config.https_proxy,
                    enable_web_fallback=config.network.enable_web_fallback,
                    timeout=config.network.request_timeout
                )
                papers = fetcher.fetch_recent(days=1, max_results=50)
            elif _ENHANCED_FETCHER_AVAILABLE:
                logger.info("Using enhanced ArXiv fetcher with web scraping fallback")
                fetcher = EnhancedArXivFetcher(
                    categories=config.arxiv_categories,
                    http_proxy=config.http_proxy,
                    https_proxy=config.https_proxy,
                    network_config=config.network
                )
                papers = fetcher.fetch_recent(days=1, max_results=50)
            elif _REGULAR_FETCHER_AVAILABLE:
                logger.info("Using regular ArXiv fetcher")
                fetcher = ArXivFetcher(
                    config.arxiv_categories,
                    http_proxy=config.http_proxy,
                    https_proxy=config.https_proxy
                )
                papers = fetcher.fetch_recent(days=1, max_results=50)
            else:
                logger.error("No ArXiv fetcher available - this indicates missing dependencies")
                logger.error("Please ensure 'arxiv' package is installed: pip install arxiv")
                return []
            
            logger.info(f"Fetched {len(papers)} papers from ArXiv")
        except Exception as e:
            logger.error(f"Failed to fetch papers: {e}")
            return []
        
        if not papers:
            logger.info("No new papers found")
            return []
        
        # Filter out papers already in storage (to save API calls)
        new_papers = []
        for paper in papers:
            existing = storage.get_paper_by_id(paper.id)
            if not existing:
                new_papers.append(paper)
        
        logger.info(f"Found {len(new_papers)} NEW papers out of {len(papers)} fetched")
        
        if not new_papers:
            logger.info("All papers already in storage, skipping scoring")
            return []
        
        # Check API key
        api_key = config.get_scoring_api_key()
        if not api_key:
            logger.warning("No API key configured, skipping scoring")
            # Still save new papers without scores
            for paper in new_papers:
                paper_dict = {
                    "arxiv_id": paper.id,
                    "title": paper.title,
                    "abstract": paper.abstract,
                    "authors": paper.authors,
                    "categories": paper.categories,
                    "published": paper.published.isoformat() if paper.published else None,
                    "source": paper.source,
                    "url": paper.url,
                }
                storage.upsert_paper(paper_dict)
            return []
        
        # Score only NEW papers
        try:
            scorer = LLMScorer(
                api_key=api_key,
                interests=config.user_interests,
                threshold=config.score_threshold,
                provider=config.get_scoring_provider(),
                model=config.get_scoring_model()
            )
            
            scored_papers = await scorer.score_batch(new_papers)
            logger.info(f"Scored {len(scored_papers)} new papers")
            
            # Save all scored papers
            for sp in scored_papers:
                paper_dict = scored_paper_to_db_dict(sp)
                storage.upsert_paper(paper_dict)
            
            # Filter high-score papers for notifications
            high_score_papers = scorer.filter_by_threshold(scored_papers)
            logger.info(f"Found {len(high_score_papers)} high-score papers (threshold: {config.score_threshold})")
            
            return high_score_papers
            
        except Exception as e:
            logger.error(f"Failed to score papers: {e}")
            return []
    
    async def _run_loop(self):
        """Main scheduler loop."""
        config = load_config()
        interval_seconds = config.fetch_interval_minutes * 60
        
        logger.info(f"Scheduler started. Fetch interval: {config.fetch_interval_minutes} minutes")
        
        # Run immediately on start
        await self._do_fetch()
        
        while self._running:
            try:
                # Wait for next interval
                await asyncio.sleep(interval_seconds)
                
                if not self._running:
                    break
                
                await self._do_fetch()
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Scheduler error: {e}")
                await asyncio.sleep(60)  # Wait a bit before retrying
    
    async def _do_fetch(self):
        """Perform a single fetch and score operation."""
        self._last_fetch_time = datetime.now(timezone.utc)
        self._fetch_count += 1
        
        logger.info(f"Fetch #{self._fetch_count} at {self._last_fetch_time}")
        
        high_score_papers = await self.fetch_and_score_papers()
        
        # Notify if high-score papers found
        if high_score_papers and self._on_high_score_papers:
            self._on_high_score_papers(high_score_papers)
    
    def start(self):
        """Start the scheduler."""
        if self._running:
            logger.warning("Scheduler already running")
            return
        
        config = load_config()
        if not config.auto_fetch_enabled:
            logger.info("Auto fetch is disabled in config")
            return
        
        self._running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("Scheduler started")
    
    def stop(self):
        """Stop the scheduler."""
        if not self._running:
            return
        
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None
        logger.info("Scheduler stopped")
    
    async def trigger_fetch(self) -> List[ScoredPaper]:
        """Manually trigger a fetch and score operation."""
        return await self._do_fetch()


# Singleton instance
_scheduler: Optional[PaperScheduler] = None


def get_scheduler() -> PaperScheduler:
    """Get or create the scheduler singleton."""
    global _scheduler
    if _scheduler is None:
        _scheduler = PaperScheduler()
    return _scheduler
