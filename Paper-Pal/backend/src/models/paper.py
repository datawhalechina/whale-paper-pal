"""Paper data models."""

from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional


@dataclass
class Paper:
    """Represents a paper fetched from ArXiv or Hugging Face."""
    
    id: str
    title: str
    abstract: str
    authors: List[str]
    categories: List[str]
    published: datetime
    source: str  # 'arxiv' | 'huggingface'
    url: str


@dataclass
class ScoredPaper:
    """Represents a paper with LLM scoring results."""
    
    paper: Paper
    relevance_score: float  # 0-10
    novelty_score: float    # 0-10
    total_score: float
    one_liner: str          # 中文一句话总结
    pros: List[str]         # 2 个优点
    cons: List[str]         # 1 个缺点
