"""LLM Scorer - Core scoring logic for papers using LLM APIs.

Feature: paper-pal, Property 5: Paper Filtering by Threshold
Feature: paper-pal, Property 6: LLM Output Structure Validity
Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
"""

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any

from openai import AsyncOpenAI

from ..models import Paper, ScoredPaper

logger = logging.getLogger(__name__)


# Scoring prompt template as defined in design.md
SCORING_PROMPT_TEMPLATE = """你是一位 AI 研究领域的专家。请根据以下用户兴趣画像，对这篇论文进行评分。

用户兴趣: {interests}

论文标题: {title}
论文摘要: {abstract}

请输出 JSON 格式：
{{
  "relevance": 0-10,      // 与用户兴趣的相关性
  "novelty": 0-10,        // 创新性和新颖程度
  "one_liner": "...",     // 中文一句话神评论
  "pros": ["...", "..."], // 2个优点
  "cons": ["..."]         // 1个缺点/局限性，没有可以为空
}}

请确保：
1. relevance 和 novelty 是 0-10 之间的数字
2. one_liner 是简洁的中文评论
3. pros 必须包含恰好 2 个优点
4. cons 必须包含恰好 1 个缺点
"""

# Provider configurations
PROVIDER_CONFIGS = {
    "gemini": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "model": "gemini-1.5-flash",
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "model": "google/gemini-2.0-flash-001",
        "extra_headers": {
            "HTTP-Referer": "https://paper-pal.app",
            "X-Title": "Paper Pal",
        },
    },
    "openai": {
        "base_url": None,  # Use default OpenAI URL
        "model": "gpt-4o-mini",
    },
    "deepseek": {
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
    },
}


class LLMScorer:
    """LLM-based paper scoring pipeline.
    
    Scores papers on relevance and novelty based on user interests,
    generates one-liner summaries, and extracts pros/cons.
    Uses OpenAI library for all LLM calls (supports OpenAI, Gemini, OpenRouter, and Deepseek).
    """
    
    def __init__(
        self,
        api_key: str,
        interests: List[str],
        threshold: float = 7.0,
        provider: str = "openrouter",  # "openai", "gemini", "openrouter", or "deepseek"
        base_url: Optional[str] = None,
        model: Optional[str] = None
    ):
        """Initialize the LLM scorer.
        
        Args:
            api_key: API key for the LLM provider
            interests: List of user interest topics
            threshold: Minimum total score threshold for filtering
            provider: LLM provider ("openai", "gemini", "openrouter", or "deepseek")
            base_url: Custom base URL for API (optional, overrides provider default)
            model: Custom model name (optional, overrides provider default)
        """
        self._api_key = api_key
        self._interests = interests
        self._threshold = threshold
        self._provider = provider.lower()
        self._extra_headers: Dict[str, str] = {}
        
        # Get provider config
        if self._provider not in PROVIDER_CONFIGS:
            raise ValueError(f"Unsupported provider: {provider}. Supported: {list(PROVIDER_CONFIGS.keys())}")
        
        config = PROVIDER_CONFIGS[self._provider]
        
        # Use custom or default base_url and model
        self._base_url = base_url or config["base_url"]
        self._model = model or config["model"]
        
        # Set extra headers for OpenRouter
        if self._provider == "openrouter":
            self._extra_headers = config.get("extra_headers", {})
        
        # Initialize OpenAI client
        client_kwargs = {"api_key": api_key}
        if self._base_url:
            client_kwargs["base_url"] = self._base_url
        
        self._client = AsyncOpenAI(**client_kwargs)
    
    @property
    def threshold(self) -> float:
        """Get the current score threshold."""
        return self._threshold
    
    @threshold.setter
    def threshold(self, value: float) -> None:
        """Set the score threshold."""
        self._threshold = value
    
    def _build_prompt(self, paper: Paper) -> str:
        """Build the scoring prompt for a paper.
        
        Args:
            paper: The paper to score
            
        Returns:
            Formatted prompt string
        """
        interests_str = ", ".join(self._interests)
        return SCORING_PROMPT_TEMPLATE.format(
            interests=interests_str,
            title=paper.title,
            abstract=paper.abstract
        )
    
    def _parse_llm_response(self, response_text: str) -> dict:
        """Parse the LLM response JSON.
        
        Args:
            response_text: Raw response text from LLM
            
        Returns:
            Parsed JSON dictionary
            
        Raises:
            ValueError: If response cannot be parsed
        """
        # Try to extract JSON from the response
        # Sometimes LLM wraps JSON in markdown code blocks
        json_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', response_text)
        if json_match:
            json_str = json_match.group(1)
        else:
            json_str = response_text.strip()
        
        try:
            return json.loads(json_str)
        except json.JSONDecodeError as e:
            raise ValueError(f"Failed to parse LLM response as JSON: {e}")
    
    def _validate_and_normalize_response(self, data: dict) -> dict:
        """Validate and normalize the parsed LLM response.
        
        Args:
            data: Parsed JSON dictionary
            
        Returns:
            Normalized dictionary with valid values
            
        Raises:
            ValueError: If required fields are missing or invalid
        """
        # Validate relevance score
        relevance = data.get("relevance")
        if relevance is None:
            raise ValueError("Missing 'relevance' field")
        relevance = float(relevance)
        relevance = max(0.0, min(10.0, relevance))  # Clamp to [0, 10]
        
        # Validate novelty score
        novelty = data.get("novelty")
        if novelty is None:
            raise ValueError("Missing 'novelty' field")
        novelty = float(novelty)
        novelty = max(0.0, min(10.0, novelty))  # Clamp to [0, 10]
        
        # Validate one_liner
        one_liner = data.get("one_liner", "")
        if not one_liner or not isinstance(one_liner, str):
            raise ValueError("Missing or invalid 'one_liner' field")
        one_liner = one_liner.strip()
        if not one_liner:
            raise ValueError("'one_liner' cannot be empty")
        
        # Validate pros (must be exactly 2)
        pros = data.get("pros", [])
        if not isinstance(pros, list):
            raise ValueError("'pros' must be a list")
        # Filter out empty strings and ensure we have non-empty strings
        pros = [str(p).strip() for p in pros if str(p).strip()]
        if len(pros) < 2:
            raise ValueError("'pros' must contain at least 2 items")
        pros = pros[:2]  # Take only first 2
        
        # Validate cons (must be exactly 1)
        cons = data.get("cons", [])
        if not isinstance(cons, list):
            raise ValueError("'cons' must be a list")
        # Filter out empty strings
        cons = [str(c).strip() for c in cons if str(c).strip()]
        if len(cons) < 1:
            raise ValueError("'cons' must contain at least 1 item")
        cons = cons[:1]  # Take only first 1
        
        return {
            "relevance": relevance,
            "novelty": novelty,
            "one_liner": one_liner,
            "pros": pros,
            "cons": cons
        }
    
    async def score_paper(self, paper: Paper) -> ScoredPaper:
        """Score a single paper using LLM.
        
        Args:
            paper: The paper to score
            
        Returns:
            ScoredPaper with scoring results
            
        Raises:
            Exception: If LLM API call fails
        """
        prompt = self._build_prompt(paper)
        
        # Build request kwargs
        request_kwargs: Dict[str, Any] = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": "你是一位专业的AI研究论文评审专家。请严格按照JSON格式输出评分结果。"},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.7,
            "max_tokens": 500
        }
        
        # Add extra headers for OpenRouter
        if self._extra_headers:
            request_kwargs["extra_headers"] = self._extra_headers
        
        # Use OpenAI library for all providers
        response = await self._client.chat.completions.create(**request_kwargs)
        response_text = response.choices[0].message.content
        
        parsed = self._parse_llm_response(response_text)
        validated = self._validate_and_normalize_response(parsed)
        
        total_score = validated["relevance"] + validated["novelty"]
        
        return ScoredPaper(
            paper=paper,
            relevance_score=validated["relevance"],
            novelty_score=validated["novelty"],
            total_score=total_score,
            one_liner=validated["one_liner"],
            pros=validated["pros"],
            cons=validated["cons"]
        )
    
    async def _score_paper_with_retry(
        self,
        paper: Paper,
        max_retries: int = 3,
        base_delay: float = 1.0
    ) -> Optional[ScoredPaper]:
        """Score a paper with exponential backoff retry logic.
        
        Args:
            paper: The paper to score
            max_retries: Maximum number of retry attempts
            base_delay: Base delay in seconds for exponential backoff
            
        Returns:
            ScoredPaper if successful, None if all retries failed
        """
        last_error = None
        
        for attempt in range(max_retries):
            try:
                return await self.score_paper(paper)
            except Exception as e:
                last_error = e
                if attempt < max_retries - 1:
                    # Exponential backoff: 1s, 2s, 4s
                    delay = base_delay * (2 ** attempt)
                    await asyncio.sleep(delay)
        
        logger.warning(f"Failed to score paper '{paper.title}' after {max_retries} attempts: {last_error}")
        return None
    
    async def score_batch(
        self,
        papers: List[Paper],
        max_retries: int = 3
    ) -> List[ScoredPaper]:
        """Score multiple papers with retry logic.
        
        Args:
            papers: List of papers to score
            max_retries: Maximum retry attempts per paper
            
        Returns:
            List of successfully scored papers (failed papers are excluded)
        """
        tasks = [
            self._score_paper_with_retry(paper, max_retries)
            for paper in papers
        ]
        
        results = await asyncio.gather(*tasks)
        
        # Filter out None results (failed scoring)
        return [r for r in results if r is not None]
    
    def filter_by_threshold(
        self,
        scored_papers: List[ScoredPaper],
        threshold: Optional[float] = None
    ) -> List[ScoredPaper]:
        """Filter papers by score threshold.
        
        Property 5: Paper Filtering by Threshold
        For any list of ScoredPaper objects and threshold value,
        this function SHALL return only papers where total_score > threshold,
        preserving the relative order of papers.
        
        Args:
            scored_papers: List of scored papers to filter
            threshold: Score threshold (uses instance threshold if not provided)
            
        Returns:
            List of papers with total_score > threshold, in original order
        """
        if threshold is None:
            threshold = self._threshold
        
        return [
            paper for paper in scored_papers
            if paper.total_score > threshold
        ]


def scored_paper_to_db_dict(scored_paper: ScoredPaper) -> dict:
    """Convert a ScoredPaper to a dictionary for database storage.
    
    Args:
        scored_paper: The scored paper to convert
        
    Returns:
        Dictionary suitable for Supabase insertion
    """
    paper = scored_paper.paper
    
    return {
        "arxiv_id": paper.id,
        "title": paper.title,
        "abstract": paper.abstract,
        "authors": paper.authors,
        "categories": paper.categories,
        "published": paper.published.isoformat() if paper.published else None,
        "source": paper.source,
        "url": paper.url,
        "relevance_score": scored_paper.relevance_score,
        "novelty_score": scored_paper.novelty_score,
        "total_score": scored_paper.total_score,
        "one_liner": scored_paper.one_liner,
        "pros": scored_paper.pros,
        "cons": scored_paper.cons,
        "scored_at": datetime.now(timezone.utc).isoformat()
    }


def store_scored_papers(
    storage,
    scored_papers: List[ScoredPaper]
) -> List[dict]:
    """Store scored papers to storage.
    
    Args:
        storage: Storage instance (JsonStorage or SupabaseClient)
        scored_papers: List of scored papers to store
        
    Returns:
        List of stored paper records
    """
    results = []
    
    for scored_paper in scored_papers:
        paper_data = scored_paper_to_db_dict(scored_paper)
        result = storage.upsert_paper(paper_data)
        results.append(result)
    
    return results
