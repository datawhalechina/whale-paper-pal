"""Pytest configuration and fixtures."""

import pytest
from datetime import datetime
from src.models import Paper, ScoredPaper


@pytest.fixture
def sample_paper() -> Paper:
    """Create a sample paper for testing."""
    return Paper(
        id="2401.00001",
        title="Sample Paper Title",
        abstract="This is a sample abstract for testing purposes.",
        authors=["Author One", "Author Two"],
        categories=["cs.AI", "cs.CL"],
        published=datetime.now(),
        source="arxiv",
        url="https://arxiv.org/abs/2401.00001"
    )


@pytest.fixture
def sample_scored_paper(sample_paper: Paper) -> ScoredPaper:
    """Create a sample scored paper for testing."""
    return ScoredPaper(
        paper=sample_paper,
        relevance_score=8.5,
        novelty_score=7.0,
        total_score=15.5,
        one_liner="这是一篇关于AI的有趣论文",
        pros=["创新性强", "实验充分"],
        cons=["缺少理论分析"]
    )
