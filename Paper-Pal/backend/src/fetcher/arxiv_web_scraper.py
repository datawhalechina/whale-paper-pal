"""ArXiv web scraper as fallback when API fails."""

import re
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional
import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


class WebScrapingError(Exception):
    """Raised when web scraping fails."""
    pass


# Simple Paper class for testing
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


class ArXivWebScraper:
    """Web scraper for ArXiv as fallback when API fails."""
    
    def __init__(self, timeout: float = 30.0):
        """Initialize the web scraper.
        
        Args:
            timeout: Request timeout in seconds
        """
        self.timeout = timeout
        self.base_url = "https://arxiv.org"
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        })
    
    def scrape_recent_papers(
        self, 
        categories: List[str], 
        days: int = 1, 
        max_results: int = 50
    ) -> List[Paper]:
        """Scrape recent papers from ArXiv website.
        
        Args:
            categories: List of ArXiv categories (e.g., ['cs.AI', 'cs.LG'])
            days: Number of days to look back
            max_results: Maximum number of papers to return
            
        Returns:
            List of Paper objects
            
        Raises:
            WebScrapingError: When scraping fails
        """
        try:
            papers = []
            cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
            
            # For simplicity, we'll scrape the "recent" page for each category
            for category in categories:
                try:
                    category_papers = self._scrape_category_recent(category, cutoff_date)
                    papers.extend(category_papers)
                    
                    if len(papers) >= max_results:
                        break
                        
                except Exception as e:
                    logger.warning(f"Failed to scrape category {category}: {e}")
                    continue
            
            # Remove duplicates and limit results
            unique_papers = self._remove_duplicates(papers)
            return unique_papers[:max_results]
            
        except Exception as e:
            logger.error(f"Web scraping failed: {e}")
            raise WebScrapingError(f"Failed to scrape ArXiv: {e}")
    
    def _scrape_category_recent(self, category: str, cutoff_date: datetime) -> List[Paper]:
        """Scrape recent papers from a specific category.
        
        Args:
            category: ArXiv category (e.g., 'cs.AI')
            cutoff_date: Only include papers after this date
            
        Returns:
            List of Paper objects from this category
        """
        # ArXiv recent submissions URL format
        url = f"{self.base_url}/list/{category}/recent"
        
        logger.debug(f"Scraping {url}")
        
        try:
            response = self.session.get(url, timeout=self.timeout)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            papers = []
            
            # Find paper entries (ArXiv uses specific HTML structure)
            paper_entries = soup.find_all('dt')
            
            for dt in paper_entries:
                try:
                    # Get the corresponding dd element with paper details
                    dd = dt.find_next_sibling('dd')
                    if not dd:
                        continue
                    
                    paper = self._parse_paper_entry(dt, dd, category)
                    if paper and paper.published >= cutoff_date:
                        papers.append(paper)
                        
                except Exception as e:
                    logger.debug(f"Failed to parse paper entry: {e}")
                    continue
            
            logger.info(f"Scraped {len(papers)} papers from {category}")
            return papers
            
        except requests.RequestException as e:
            logger.error(f"Failed to fetch {url}: {e}")
            raise WebScrapingError(f"Failed to fetch category {category}: {e}")
    
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
            # Extract paper ID from the dt element
            arxiv_id = None
            links = dt_element.find_all('a')
            for link in links:
                href = link.get('href', '')
                if '/abs/' in href:
                    arxiv_id = href.split('/abs/')[-1]
                    break
            
            if not arxiv_id:
                return None
            
            # Extract title (usually in the first div with class 'list-title')
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
            
            # Extract abstract/summary
            abstract_div = dd_element.find('p', class_='mathjax')
            abstract = ""
            if abstract_div:
                abstract = abstract_div.get_text().strip()
            
            # For web scraping, we'll use current time as published date
            # This is a limitation of web scraping vs API
            published = datetime.now(timezone.utc)
            
            # Create paper object
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
        """Remove duplicate papers based on ID.
        
        Args:
            papers: List of papers that may contain duplicates
            
        Returns:
            List of unique papers
        """
        seen_ids = set()
        unique_papers = []
        
        for paper in papers:
            if paper.id not in seen_ids:
                seen_ids.add(paper.id)
                unique_papers.append(paper)
        
        return unique_papers