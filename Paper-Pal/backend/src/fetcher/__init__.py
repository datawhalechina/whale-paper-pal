"""ArXiv and Hugging Face paper fetchers."""

# Always available base components
from .base_fetcher import FetchMethod, FetchResult
from .exceptions import ArXivFetchError, ArXivAPIError, WebScrapingError
from .retry_handler import RetryHandler
from .arxiv_web_scraper import ArXivWebScraper

# Conditionally import enhanced fetcher
try:
    from .enhanced_arxiv_fetcher import EnhancedArXivFetcher
    _ENHANCED_AVAILABLE = True
except ImportError:
    _ENHANCED_AVAILABLE = False

# Conditionally import fetchers that may have dependencies
try:
    from .arxiv_fetcher import ArXivFetcher, SUPPORTED_CATEGORIES
    _ARXIV_AVAILABLE = True
except ImportError:
    _ARXIV_AVAILABLE = False

try:
    from .huggingface_fetcher import HuggingFaceFetcher, HF_DAILY_PAPERS_URL
    _HUGGINGFACE_AVAILABLE = True
except ImportError:
    _HUGGINGFACE_AVAILABLE = False

__all__ = [
    "FetchMethod",
    "FetchResult",
    "ArXivFetchError",
    "ArXivAPIError",
    "WebScrapingError",
    "RetryHandler",
    "ArXivWebScraper"
]

# Add conditionally available exports
if _ENHANCED_AVAILABLE:
    __all__.append("EnhancedArXivFetcher")

if _ARXIV_AVAILABLE:
    __all__.extend(["ArXivFetcher", "SUPPORTED_CATEGORIES"])

if _HUGGINGFACE_AVAILABLE:
    __all__.extend(["HuggingFaceFetcher", "HF_DAILY_PAPERS_URL"])
