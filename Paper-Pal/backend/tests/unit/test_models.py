"""Unit tests for data models."""

from datetime import datetime
from src.models import Paper, ScoredPaper


def test_paper_creation():
    """Test Paper dataclass creation."""
    paper = Paper(
        id="2401.00001",
        title="Test Paper",
        abstract="Test abstract",
        authors=["Author"],
        categories=["cs.AI"],
        published=datetime.now(),
        source="arxiv",
        url="https://arxiv.org/abs/2401.00001"
    )
    
    assert paper.id == "2401.00001"
    assert paper.title == "Test Paper"
    assert paper.source == "arxiv"


def test_scored_paper_creation(sample_paper):
    """Test ScoredPaper dataclass creation."""
    scored = ScoredPaper(
        paper=sample_paper,
        relevance_score=8.0,
        novelty_score=7.0,
        total_score=15.0,
        one_liner="测试评论",
        pros=["优点1", "优点2"],
        cons=["缺点1"]
    )
    
    assert scored.relevance_score == 8.0
    assert scored.novelty_score == 7.0
    assert len(scored.pros) == 2
    assert len(scored.cons) == 1
