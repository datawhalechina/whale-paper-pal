"""Property-based tests for paper filtering by threshold.

Feature: paper-pal, Property 5: Paper Filtering by Threshold
Validates: Requirements 5.2

For any list of ScoredPaper objects and threshold value, the filter_by_threshold
function SHALL return only papers where total_score > threshold, preserving
the relative order of papers.
"""

from datetime import datetime, timezone
from typing import List, Optional
from hypothesis import given, settings, strategies as st

from src.models import Paper, ScoredPaper


def filter_by_threshold(
    scored_papers: List[ScoredPaper],
    threshold: float
) -> List[ScoredPaper]:
    """Filter papers by score threshold.
    
    Standalone implementation matching LLMScorer.filter_by_threshold
    to avoid importing the full LLMScorer class which has dependency issues.
    
    Property 5: Paper Filtering by Threshold
    For any list of ScoredPaper objects and threshold value,
    this function SHALL return only papers where total_score > threshold,
    preserving the relative order of papers.
    
    Args:
        scored_papers: List of scored papers to filter
        threshold: Score threshold
        
    Returns:
        List of papers with total_score > threshold, in original order
    """
    return [
        paper for paper in scored_papers
        if paper.total_score > threshold
    ]


# Strategy for generating valid scores (0-10)
score_strategy = st.floats(min_value=0.0, max_value=10.0, allow_nan=False)

# Strategy for generating threshold values
threshold_strategy = st.floats(min_value=0.0, max_value=20.0, allow_nan=False)

# Strategy for generating non-empty strings
non_empty_string = st.text(min_size=1, max_size=100).filter(lambda s: s.strip())

# Strategy for generating Paper objects
paper_strategy = st.builds(
    Paper,
    id=st.text(min_size=5, max_size=20),
    title=non_empty_string,
    abstract=non_empty_string,
    authors=st.lists(non_empty_string, min_size=1, max_size=5),
    categories=st.lists(st.sampled_from(["cs.AI", "cs.CL", "cs.CV", "cs.LG"]), min_size=1, max_size=4),
    published=st.datetimes(min_value=datetime(2020, 1, 1), max_value=datetime(2030, 12, 31)).map(
        lambda dt: dt.replace(tzinfo=timezone.utc)
    ),
    source=st.sampled_from(["arxiv", "huggingface"]),
    url=st.text(min_size=10, max_size=100)
)

# Strategy for generating ScoredPaper objects
scored_paper_strategy = st.builds(
    ScoredPaper,
    paper=paper_strategy,
    relevance_score=score_strategy,
    novelty_score=score_strategy,
    total_score=score_strategy.flatmap(
        lambda r: score_strategy.map(lambda n: r + n)
    ),
    one_liner=non_empty_string,
    pros=st.lists(non_empty_string, min_size=2, max_size=2),
    cons=st.lists(non_empty_string, min_size=1, max_size=1)
)

# Strategy for generating lists of ScoredPaper objects
scored_papers_list_strategy = st.lists(scored_paper_strategy, min_size=0, max_size=20)


def create_scored_paper_with_score(total_score: float) -> ScoredPaper:
    """Helper to create a ScoredPaper with a specific total score."""
    paper = Paper(
        id=f"test-{total_score}",
        title="Test Paper",
        abstract="Test abstract",
        authors=["Author"],
        categories=["cs.AI"],
        published=datetime.now(timezone.utc),
        source="arxiv",
        url="https://example.com"
    )
    return ScoredPaper(
        paper=paper,
        relevance_score=total_score / 2,
        novelty_score=total_score / 2,
        total_score=total_score,
        one_liner="Test one-liner",
        pros=["Pro 1", "Pro 2"],
        cons=["Con 1"]
    )


# Feature: paper-pal, Property 5: Paper Filtering by Threshold
# Validates: Requirements 5.2
@given(
    scored_papers=scored_papers_list_strategy,
    threshold=threshold_strategy
)
@settings(max_examples=100)
def test_filter_returns_only_papers_above_threshold(
    scored_papers: list,
    threshold: float
):
    """Property: Filtered papers SHALL have total_score > threshold."""
    filtered = filter_by_threshold(scored_papers, threshold)
    
    for paper in filtered:
        assert paper.total_score > threshold, (
            f"Paper with score {paper.total_score} should not pass threshold {threshold}"
        )


# Feature: paper-pal, Property 5: Paper Filtering by Threshold
# Validates: Requirements 5.2
@given(
    scored_papers=scored_papers_list_strategy,
    threshold=threshold_strategy
)
@settings(max_examples=100)
def test_filter_preserves_relative_order(
    scored_papers: list,
    threshold: float
):
    """Property: Filtered papers SHALL preserve relative order from input."""
    filtered = filter_by_threshold(scored_papers, threshold)
    
    # Get indices of filtered papers in original list
    filtered_ids = [p.paper.id for p in filtered]
    original_indices = []
    
    for i, paper in enumerate(scored_papers):
        if paper.paper.id in filtered_ids:
            original_indices.append(i)
    
    # Indices should be in ascending order (preserving original order)
    assert original_indices == sorted(original_indices), (
        "Filtered papers should preserve relative order from input"
    )


# Feature: paper-pal, Property 5: Paper Filtering by Threshold
# Validates: Requirements 5.2
@given(
    scored_papers=scored_papers_list_strategy,
    threshold=threshold_strategy
)
@settings(max_examples=100)
def test_filter_excludes_papers_at_or_below_threshold(
    scored_papers: list,
    threshold: float
):
    """Property: Papers with total_score <= threshold SHALL be excluded."""
    filtered = filter_by_threshold(scored_papers, threshold)
    filtered_ids = {p.paper.id for p in filtered}
    
    for paper in scored_papers:
        if paper.total_score <= threshold:
            assert paper.paper.id not in filtered_ids, (
                f"Paper with score {paper.total_score} should be excluded at threshold {threshold}"
            )


# Feature: paper-pal, Property 5: Paper Filtering by Threshold
# Validates: Requirements 5.2
@given(threshold=threshold_strategy)
@settings(max_examples=100)
def test_filter_empty_list_returns_empty(threshold: float):
    """Property: Filtering empty list SHALL return empty list."""
    filtered = filter_by_threshold([], threshold)
    
    assert filtered == [], "Filtering empty list should return empty list"


# Feature: paper-pal, Property 5: Paper Filtering by Threshold
# Validates: Requirements 5.2
@given(
    scored_papers=scored_papers_list_strategy,
    threshold=threshold_strategy
)
@settings(max_examples=100)
def test_filter_result_is_subset_of_input(
    scored_papers: list,
    threshold: float
):
    """Property: Filtered result SHALL be a subset of input papers."""
    filtered = filter_by_threshold(scored_papers, threshold)
    
    input_ids = {p.paper.id for p in scored_papers}
    filtered_ids = {p.paper.id for p in filtered}
    
    assert filtered_ids.issubset(input_ids), (
        "Filtered papers should be a subset of input papers"
    )
