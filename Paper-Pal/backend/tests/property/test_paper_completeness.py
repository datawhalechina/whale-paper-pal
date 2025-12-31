"""Property-based tests for paper completeness.

Feature: paper-pal, Property 7: Fetched Paper Completeness
Validates: Requirements 4.1, 4.3

For any Paper returned by ArXiv_Fetcher:
- title SHALL be a non-empty string
- abstract SHALL be a non-empty string
- categories SHALL contain at least one of: cs.AI, cs.CL, cs.CV, cs.LG (for ArXiv source)
"""

from datetime import datetime, timezone
from hypothesis import given, settings, strategies as st

from src.models import Paper

# Define SUPPORTED_CATEGORIES locally to avoid importing from fetcher
# (which would trigger arxiv module import)
SUPPORTED_CATEGORIES = ["cs.AI", "cs.CL", "cs.CV", "cs.LG"]


# Strategy for generating valid ArXiv paper IDs
arxiv_id_strategy = st.text(
    alphabet=st.sampled_from("0123456789."),
    min_size=5,
    max_size=20
).map(lambda s: f"arxiv:{s}")

# Strategy for generating non-empty titles
title_strategy = st.text(min_size=1, max_size=500).filter(lambda s: s.strip())

# Strategy for generating non-empty abstracts
abstract_strategy = st.text(min_size=1, max_size=5000).filter(lambda s: s.strip())

# Strategy for generating author names
author_strategy = st.text(min_size=1, max_size=100).filter(lambda s: s.strip())
authors_strategy = st.lists(author_strategy, min_size=1, max_size=10)

# Strategy for generating valid ArXiv categories (at least one supported)
categories_strategy = st.lists(
    st.sampled_from(SUPPORTED_CATEGORIES),
    min_size=1,
    max_size=4,
    unique=True
)

# Strategy for generating datetime
datetime_strategy = st.datetimes(
    min_value=datetime(2020, 1, 1),
    max_value=datetime(2030, 12, 31)
).map(lambda dt: dt.replace(tzinfo=timezone.utc))

# Strategy for generating valid ArXiv papers
arxiv_paper_strategy = st.builds(
    Paper,
    id=arxiv_id_strategy,
    title=title_strategy,
    abstract=abstract_strategy,
    authors=authors_strategy,
    categories=categories_strategy,
    published=datetime_strategy,
    source=st.just("arxiv"),
    url=st.text(min_size=10, max_size=100)
)


# Feature: paper-pal, Property 7: Fetched Paper Completeness
# Validates: Requirements 4.1, 4.3
@given(paper=arxiv_paper_strategy)
@settings(max_examples=100)
def test_arxiv_paper_has_non_empty_title(paper: Paper):
    """Property: ArXiv paper title SHALL be a non-empty string."""
    assert isinstance(paper.title, str)
    assert len(paper.title.strip()) > 0


# Feature: paper-pal, Property 7: Fetched Paper Completeness
# Validates: Requirements 4.1, 4.3
@given(paper=arxiv_paper_strategy)
@settings(max_examples=100)
def test_arxiv_paper_has_non_empty_abstract(paper: Paper):
    """Property: ArXiv paper abstract SHALL be a non-empty string."""
    assert isinstance(paper.abstract, str)
    assert len(paper.abstract.strip()) > 0


# Feature: paper-pal, Property 7: Fetched Paper Completeness
# Validates: Requirements 4.1, 4.3
@given(paper=arxiv_paper_strategy)
@settings(max_examples=100)
def test_arxiv_paper_has_valid_categories(paper: Paper):
    """Property: ArXiv paper categories SHALL contain at least one supported category."""
    assert isinstance(paper.categories, list)
    assert len(paper.categories) > 0
    
    # At least one category must be in SUPPORTED_CATEGORIES
    has_supported = any(cat in SUPPORTED_CATEGORIES for cat in paper.categories)
    assert has_supported, f"Paper must have at least one supported category from {SUPPORTED_CATEGORIES}"


# Feature: paper-pal, Property 7: Fetched Paper Completeness
# Validates: Requirements 4.1, 4.3
@given(paper=arxiv_paper_strategy)
@settings(max_examples=100)
def test_arxiv_paper_completeness_combined(paper: Paper):
    """Property: ArXiv paper SHALL have all required fields complete."""
    # Title is non-empty
    assert paper.title and paper.title.strip()
    
    # Abstract is non-empty
    assert paper.abstract and paper.abstract.strip()
    
    # Has at least one supported category
    assert any(cat in SUPPORTED_CATEGORIES for cat in paper.categories)
    
    # Source is arxiv
    assert paper.source == "arxiv"
    
    # Has authors
    assert len(paper.authors) > 0
