"""Configuration management for Paper Pal backend."""

import os
from dataclasses import dataclass
from typing import List, Optional

from dotenv import load_dotenv

load_dotenv()


@dataclass
class NetworkConfig:
    """Simple configuration for ArXiv fallback mechanism."""
    
    # Enable web scraping fallback when ArXiv API fails
    enable_web_fallback: bool = True
    
    # Request timeout in seconds
    request_timeout: float = 30.0
    
    # Cache duration in days
    cache_duration_days: int = 7
    
    # Enable offline mode (use cache when network fails)
    enable_offline_mode: bool = True


@dataclass
class Config:
    """Application configuration."""
    
    # Supabase
    supabase_url: str
    supabase_key: str
    
    # Global LLM API Key (fallback for all functions)
    llm_api_key: Optional[str] = None
    
    # Function-specific LLM API Keys (override global if set)
    scoring_api_key: Optional[str] = None
    chat_api_key: Optional[str] = None
    
    # LLM Provider settings
    llm_provider: str = "openrouter"  # "openai", "gemini", "openrouter", or "deepseek"
    llm_model: Optional[str] = None  # Custom model name (optional)
    
    # Function-specific LLM Provider settings (override global if set)
    scoring_provider: Optional[str] = None
    scoring_model: Optional[str] = None
    chat_provider: Optional[str] = None
    chat_model: Optional[str] = None
    
    # Proxy settings
    http_proxy: Optional[str] = None
    https_proxy: Optional[str] = None
    
    # ArXiv categories to fetch
    arxiv_categories: List[str] = None
    
    # User interests for paper scoring
    user_interests: List[str] = None
    
    # Scoring threshold
    score_threshold: float = 7.0
    
    # Auto fetch settings
    fetch_interval_minutes: int = 60
    auto_fetch_enabled: bool = True
    
    # Network resilience configuration
    network: NetworkConfig = None
    
    def __post_init__(self):
        if self.arxiv_categories is None:
            self.arxiv_categories = ["cs.AI", "cs.CL", "cs.CV", "cs.LG"]
        if self.user_interests is None:
            self.user_interests = ["LLM", "RAG", "Agent", "多模态", "大语言模型"]
        if self.network is None:
            self.network = NetworkConfig()
    
    def get_scoring_api_key(self) -> Optional[str]:
        """Get API key for scoring function."""
        return self.scoring_api_key or self.llm_api_key
    
    def get_chat_api_key(self) -> Optional[str]:
        """Get API key for chat function."""
        return self.chat_api_key or self.llm_api_key
    
    def get_scoring_provider(self) -> str:
        """Get LLM provider for scoring function."""
        return self.scoring_provider or self.llm_provider
    
    def get_scoring_model(self) -> Optional[str]:
        """Get LLM model for scoring function."""
        return self.scoring_model or self.llm_model
    
    def get_chat_provider(self) -> str:
        """Get LLM provider for chat function."""
        return self.chat_provider or self.llm_provider
    
    def get_chat_model(self) -> Optional[str]:
        """Get LLM model for chat function."""
        return self.chat_model or self.llm_model


def _get_proxy_value(env_var: str) -> Optional[str]:
    """Get proxy value, treating empty string as None."""
    value = os.getenv(env_var, "")
    return value if value.strip() else None


def _get_bool_value(env_var: str, default: bool = False) -> bool:
    """Get boolean value from environment variable."""
    value = os.getenv(env_var, "").lower().strip()
    if value in ("true", "1", "yes", "on"):
        return True
    if value in ("false", "0", "no", "off"):
        return False
    return default


def _get_list_value(env_var: str, default: Optional[List[str]] = None) -> Optional[List[str]]:
    """Get list value from environment variable (comma-separated)."""
    value = os.getenv(env_var, "").strip()
    if not value:
        return default
    
    # Split by comma and clean up whitespace
    items = [item.strip() for item in value.split(",")]
    # Filter out empty items
    items = [item for item in items if item]
    
    return items if items else default


def load_config() -> Config:
    """Load configuration from environment variables."""
    # Load simple network configuration from environment
    network_config = NetworkConfig(
        enable_web_fallback=_get_bool_value("NETWORK_ENABLE_WEB_FALLBACK", True),
        request_timeout=float(os.getenv("NETWORK_REQUEST_TIMEOUT", "30.0")),
        cache_duration_days=int(os.getenv("NETWORK_CACHE_DURATION_DAYS", "7")),
        enable_offline_mode=_get_bool_value("NETWORK_ENABLE_OFFLINE_MODE", True),
    )
    
    return Config(
        supabase_url=os.getenv("SUPABASE_URL", ""),
        supabase_key=os.getenv("SUPABASE_KEY", ""),
        llm_api_key=os.getenv("LLM_API_KEY"),
        scoring_api_key=os.getenv("SCORING_API_KEY"),
        chat_api_key=os.getenv("CHAT_API_KEY"),
        llm_provider=os.getenv("LLM_PROVIDER", "openrouter"),
        llm_model=os.getenv("LLM_MODEL") or None,
        scoring_provider=os.getenv("SCORING_PROVIDER") or None,
        scoring_model=os.getenv("SCORING_MODEL") or None,
        chat_provider=os.getenv("CHAT_PROVIDER") or None,
        chat_model=os.getenv("CHAT_MODEL") or None,
        http_proxy=_get_proxy_value("HTTP_PROXY"),
        https_proxy=_get_proxy_value("HTTPS_PROXY"),
        arxiv_categories=_get_list_value("ARXIV_CATEGORIES"),
        user_interests=_get_list_value("USER_INTERESTS"),
        score_threshold=float(os.getenv("SCORE_THRESHOLD", "7.0")),
        fetch_interval_minutes=int(os.getenv("FETCH_INTERVAL_MINUTES", "60")),
        auto_fetch_enabled=_get_bool_value("AUTO_FETCH_ENABLED", True),
        network=network_config,
    )
