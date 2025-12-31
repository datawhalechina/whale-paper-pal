"""Simple exceptions for ArXiv fallback mechanism."""


class ArXivFetchError(Exception):
    """Base exception for ArXiv fetching errors."""
    pass


class ArXivAPIError(ArXivFetchError):
    """Raised when ArXiv API fails."""
    pass


class WebScrapingError(ArXivFetchError):
    """Raised when web scraping fails."""
    pass