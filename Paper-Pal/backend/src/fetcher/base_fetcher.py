"""Simple fallback mechanism for ArXiv fetching."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import List, Optional

from ..models.paper import Paper


class FetchMethod(Enum):
    """Method used to fetch papers."""
    ARXIV_API = "arxiv_api"
    WEB_SCRAPING = "web_scraping"
    CACHE = "cache"


@dataclass
class FetchResult:
    """Result of a paper fetch operation."""
    papers: List[Paper]
    method: FetchMethod
    success: bool
    error_message: Optional[str] = None
    fetch_time: datetime = field(default_factory=lambda: datetime.now(timezone.utc))