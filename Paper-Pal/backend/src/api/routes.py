"""API routes for Paper Pal backend.

Requirements: 6.1, 7.2, 8.2
"""

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import JSONResponse

from .models import (
    PaperResponse,
    PaperListResponse,
    FetchPapersRequest,
    ScorePapersRequest,
    ChatMessageRequest,
    ChatMessageResponse,
    QuickCommandRequest,
    NotificationResponse,
    NotificationListResponse,
    SavePaperRequest,
    SavePaperResponse,
    SavedPaperResponse,
    SavedPapersListResponse,
    GetSavedPapersRequest,
    PDFProcessingRequest,
    PDFProcessingResponse,
    PDFStatusResponse,
    PDFSearchRequest,
    PDFSearchResult,
    PDFSearchResponse,
    PDFChatRequest,
)
from ..models import Paper, ScoredPaper

# Try to import enhanced fetcher, fallback to regular fetcher
try:
    from ..fetcher import EnhancedArXivFetcher
    _ENHANCED_FETCHER_AVAILABLE = True
except ImportError:
    _ENHANCED_FETCHER_AVAILABLE = False

try:
    from ..fetcher import ArXivFetcher, HuggingFaceFetcher
    _REGULAR_FETCHER_AVAILABLE = True
except ImportError:
    _REGULAR_FETCHER_AVAILABLE = False
from ..scorer import LLMScorer, scored_paper_to_db_dict, store_scored_papers
from ..db import get_json_storage
from ..config import load_config
from ..rag import RAGService

import logging

logger = logging.getLogger(__name__)

# Create routers
papers_router = APIRouter(prefix="/api/papers", tags=["papers"])
chat_router = APIRouter(prefix="/api/chat", tags=["chat"])
notifications_router = APIRouter(prefix="/api/notifications", tags=["notifications"])
pdf_router = APIRouter(prefix="/api/pdf", tags=["pdf"])

# Global RAG service instance
_rag_service: Optional[RAGService] = None

def get_rag_service() -> RAGService:
    """Get or create RAG service instance."""
    global _rag_service
    if _rag_service is None:
        _rag_service = RAGService()
    return _rag_service

# In-memory notification queue (for simplicity)
_notification_queue: List[NotificationResponse] = []

# In-memory paper storage (temporary solution)
_papers_cache: List[PaperResponse] = []


def add_notification(paper_id: str, title: str, source: str, score: float):
    """Add a notification to the queue (called by scheduler)."""
    global _notification_queue
    notification = NotificationResponse(
        id=f"notif-{paper_id}-{datetime.now(timezone.utc).timestamp()}",
        paper_id=paper_id,
        title=title,
        source=source,
        score=score,
        timestamp=datetime.now(timezone.utc),
    )
    _notification_queue.append(notification)


def get_config():
    """Dependency to get config."""
    return load_config()


def paper_to_response(paper: Paper, scored: Optional[ScoredPaper] = None) -> PaperResponse:
    """Convert Paper model to API response."""
    if scored:
        return PaperResponse(
            id=paper.id,
            title=paper.title,
            abstract=paper.abstract,
            authors=paper.authors,
            categories=paper.categories,
            published=paper.published,
            source=paper.source,
            url=paper.url,
            relevance_score=scored.relevance_score,
            novelty_score=scored.novelty_score,
            total_score=scored.total_score,
            one_liner=scored.one_liner,
            pros=scored.pros,
            cons=scored.cons,
        )
    return PaperResponse(
        id=paper.id,
        title=paper.title,
        abstract=paper.abstract,
        authors=paper.authors,
        categories=paper.categories,
        published=paper.published,
        source=paper.source,
        url=paper.url,
    )


# Papers endpoints
@papers_router.get("/", response_model=PaperListResponse)
async def get_papers(
    limit: int = 50,
    offset: int = 0,
    min_score: Optional[float] = None,
    config=Depends(get_config),
):
    """Get scored papers from storage.
    
    Requirements: 7.2 - Dashboard displays today's selected papers
    """
    global _papers_cache
    
    try:
        # Try JSON storage first
        storage = get_json_storage()
        papers_data = storage.get_papers(limit=limit, offset=offset, min_score=min_score)
        
        if papers_data:
            papers = [
                PaperResponse(
                    id=p.get("arxiv_id", p.get("id", "")),
                    title=p.get("title", ""),
                    abstract=p.get("abstract", ""),
                    authors=p.get("authors", []),
                    categories=p.get("categories", []),
                    published=datetime.fromisoformat(p["published"]) if p.get("published") else datetime.now(timezone.utc),
                    source=p.get("source", "arxiv"),
                    url=p.get("url", ""),
                    relevance_score=p.get("relevance_score"),
                    novelty_score=p.get("novelty_score"),
                    total_score=p.get("total_score"),
                    one_liner=p.get("one_liner"),
                    pros=p.get("pros"),
                    cons=p.get("cons"),
                )
                for p in papers_data
            ]
            return PaperListResponse(papers=papers, total=len(papers))
        
        # Fallback to memory cache
        filtered_papers = _papers_cache
        if min_score is not None:
            filtered_papers = [p for p in _papers_cache if p.total_score and p.total_score >= min_score]
        
        # Apply pagination
        start = offset
        end = offset + limit
        paginated_papers = filtered_papers[start:end]
        
        return PaperListResponse(papers=paginated_papers, total=len(filtered_papers))
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@papers_router.get("/saved", response_model=SavedPapersListResponse)
async def get_saved_papers(
    user_id: str = "default",
    limit: int = 50,
    offset: int = 0,
    config=Depends(get_config)
):
    """Get saved papers for a user.
    
    Requirements: 7.3 - "稍后读" functionality - view saved papers
    """
    try:
        storage = get_json_storage()
        saved_papers_data = storage.get_saved_papers(user_id)
        
        logger.info(f"Found {len(saved_papers_data)} saved papers for user {user_id}")
        
        # Apply pagination
        start = offset
        end = offset + limit
        paginated_saved = saved_papers_data[start:end]
        
        # Convert to response format
        saved_papers = []
        for saved_data in paginated_saved:
            paper_id = saved_data.get('paper_id')
            saved_at_str = saved_data.get('saved_at')
            
            logger.info(f"Processing saved paper with ID: {paper_id}")
            
            # Parse saved_at timestamp
            try:
                saved_at = datetime.fromisoformat(saved_at_str.replace('Z', '+00:00'))
            except Exception as parse_error:
                logger.warning(f"Failed to parse saved_at: {parse_error}")
                saved_at = datetime.now(timezone.utc)
            
            # Try to get paper details from multiple sources
            paper_response = None
            
            # First, check if paper data is already included in saved_data
            if 'paper' in saved_data and saved_data['paper']:
                logger.info(f"Found paper data in saved_data for {paper_id}")
                paper_data = saved_data['paper']
                
                paper_response = PaperResponse(
                    id=paper_data.get("arxiv_id", paper_data.get("id", "")),
                    title=paper_data.get("title", ""),
                    abstract=paper_data.get("abstract", ""),
                    authors=paper_data.get("authors", []),
                    categories=paper_data.get("categories", []),
                    published=datetime.fromisoformat(paper_data["published"]) if paper_data.get("published") else datetime.now(timezone.utc),
                    source=paper_data.get("source", "arxiv"),
                    url=paper_data.get("url", ""),
                    relevance_score=paper_data.get("relevance_score"),
                    novelty_score=paper_data.get("novelty_score"),
                    total_score=paper_data.get("total_score"),
                    one_liner=paper_data.get("one_liner"),
                    pros=paper_data.get("pros"),
                    cons=paper_data.get("cons"),
                )
                    
            else:
                # Fallback: try to find paper in storage
                logger.info(f"Looking up paper in storage for {paper_id}")
                paper_data = storage.get_paper_by_id(paper_id)
                if paper_data:
                    logger.info(f"Found paper in storage for {paper_id}")
                    paper_response = PaperResponse(
                        id=paper_data.get("arxiv_id", paper_data.get("id", "")),
                        title=paper_data.get("title", ""),
                        abstract=paper_data.get("abstract", ""),
                        authors=paper_data.get("authors", []),
                        categories=paper_data.get("categories", []),
                        published=datetime.fromisoformat(paper_data["published"]) if paper_data.get("published") else datetime.now(timezone.utc),
                        source=paper_data.get("source", "arxiv"),
                        url=paper_data.get("url", ""),
                        relevance_score=paper_data.get("relevance_score"),
                        novelty_score=paper_data.get("novelty_score"),
                        total_score=paper_data.get("total_score"),
                        one_liner=paper_data.get("one_liner"),
                        pros=paper_data.get("pros"),
                        cons=paper_data.get("cons"),
                    )
                else:
                    # Last resort: try to find in memory cache
                    logger.info(f"Looking up paper in memory cache for {paper_id}")
                    for p in _papers_cache:
                        if p.id == paper_id:
                            logger.info(f"Found paper in memory cache for {paper_id}")
                            paper_response = p
                            break
                    
                    if not paper_response:
                        logger.warning(f"Paper not found anywhere for {paper_id}")
            
            saved_papers.append(SavedPaperResponse(
                paper_id=paper_id,
                saved_at=saved_at,
                paper=paper_response
            ))
        
        return SavedPapersListResponse(
            saved_papers=saved_papers,
            total=len(saved_papers_data)
        )
        
    except Exception as e:
        logger.error(f"Error getting saved papers: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@papers_router.delete("/saved/remove")
async def remove_saved_paper_query(
    paper_id: str = Query(...),
    user_id: str = Query(default="default"),
    config=Depends(get_config)
):
    """Remove a saved paper for a user using query parameters.
    
    Requirements: 7.3 - "稍后读" functionality - remove saved papers
    """
    try:
        logger.info(f"Removing saved paper {paper_id} for user {user_id}")
        storage = get_json_storage()
        success = storage.remove_saved_paper(user_id, paper_id)
        
        if success:
            logger.info(f"Paper removed successfully")
            return {"success": True, "message": "Paper removed from saved list"}
        else:
            logger.warning(f"Paper not found in saved list")
            raise HTTPException(status_code=404, detail="Paper not found in saved list")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing saved paper {paper_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@papers_router.delete("/saved/{paper_id:path}")
async def remove_saved_paper(
    paper_id: str,
    user_id: str = Query(default="default"),
    config=Depends(get_config)
):
    """Remove a saved paper for a user.
    
    Requirements: 7.3 - "稍后读" functionality - remove saved papers
    """
    try:
        logger.info(f"Removing saved paper {paper_id} for user {user_id}")
        storage = get_json_storage()
        success = storage.remove_saved_paper(user_id, paper_id)
        
        if success:
            logger.info(f"Paper removed successfully")
            return {"success": True, "message": "Paper removed from saved list"}
        else:
            logger.warning(f"Paper not found in saved list")
            raise HTTPException(status_code=404, detail="Paper not found in saved list")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing saved paper {paper_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@papers_router.get("/{paper_id}", response_model=PaperResponse)
async def get_paper(paper_id: str, config=Depends(get_config)):
    """Get a single paper by ID."""
    try:
        storage = get_json_storage()
        paper_data = storage.get_paper_by_id(paper_id)
        
        if not paper_data:
            # Try memory cache
            for p in _papers_cache:
                if p.id == paper_id:
                    return p
            raise HTTPException(status_code=404, detail="Paper not found")
        
        return PaperResponse(
            id=paper_data.get("arxiv_id", paper_data.get("id", "")),
            title=paper_data.get("title", ""),
            abstract=paper_data.get("abstract", ""),
            authors=paper_data.get("authors", []),
            categories=paper_data.get("categories", []),
            published=datetime.fromisoformat(paper_data["published"]) if paper_data.get("published") else datetime.now(timezone.utc),
            source=paper_data.get("source", "arxiv"),
            url=paper_data.get("url", ""),
            relevance_score=paper_data.get("relevance_score"),
            novelty_score=paper_data.get("novelty_score"),
            total_score=paper_data.get("total_score"),
            one_liner=paper_data.get("one_liner"),
            pros=paper_data.get("pros"),
            cons=paper_data.get("cons"),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@papers_router.post("/fetch")
async def fetch_papers(request: FetchPapersRequest, config=Depends(get_config)):
    """Fetch new papers from ArXiv and HuggingFace.
    
    Requirements: 4.1, 4.2 - Fetch papers from multiple sources
    """
    global _papers_cache
    
    try:
        # Use enhanced fetcher if available, fallback to regular fetcher
        if _ENHANCED_FETCHER_AVAILABLE:
            fetcher = EnhancedArXivFetcher(
                categories=config.arxiv_categories,
                http_proxy=config.http_proxy,
                https_proxy=config.https_proxy,
                network_config=config.network
            )
        elif _REGULAR_FETCHER_AVAILABLE:
            fetcher = ArXivFetcher(
                config.arxiv_categories,
                http_proxy=config.http_proxy,
                https_proxy=config.https_proxy
            )
        else:
            raise HTTPException(status_code=500, detail="No ArXiv fetcher available")
        
        papers = fetcher.fetch_recent(days=request.days, max_results=request.max_results)
        
        # Also try HuggingFace
        try:
            if _REGULAR_FETCHER_AVAILABLE:
                hf_fetcher = HuggingFaceFetcher()
                hf_papers = hf_fetcher.fetch_daily()
                papers.extend(hf_papers)
        except Exception:
            pass  # HuggingFace fetch is optional
        
        # Convert to response format and store in cache
        paper_responses = [paper_to_response(p) for p in papers]
        _papers_cache.extend(paper_responses)
        
        # Remove duplicates based on ID
        seen_ids = set()
        unique_papers = []
        for paper in _papers_cache:
            if paper.id not in seen_ids:
                seen_ids.add(paper.id)
                unique_papers.append(paper)
        _papers_cache = unique_papers
        
        return {
            "success": True,
            "count": len(papers),
            "papers": paper_responses,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@papers_router.post("/score")
async def score_papers(request: ScorePapersRequest, config=Depends(get_config)):
    """Score papers using LLM.
    
    Requirements: 5.1, 5.2, 6.1 - Score papers and trigger notifications
    """
    global _notification_queue
    
    scoring_api_key = config.get_scoring_api_key()
    if not scoring_api_key:
        raise HTTPException(status_code=400, detail="Scoring API key not configured")
    
    try:
        # Fetch papers to score using enhanced fetcher if available
        if _ENHANCED_FETCHER_AVAILABLE:
            fetcher = EnhancedArXivFetcher(
                categories=config.arxiv_categories,
                http_proxy=config.http_proxy,
                https_proxy=config.https_proxy,
                network_config=config.network
            )
        elif _REGULAR_FETCHER_AVAILABLE:
            fetcher = ArXivFetcher(
                config.arxiv_categories,
                http_proxy=config.http_proxy,
                https_proxy=config.https_proxy
            )
        else:
            raise HTTPException(status_code=500, detail="No ArXiv fetcher available")
        
        papers = fetcher.fetch_recent(days=1, max_results=50)
        
        # Score papers using configured provider
        interests = request.interests or config.user_interests
        scorer = LLMScorer(
            api_key=scoring_api_key,
            interests=interests,
            threshold=request.threshold,
            provider=config.get_scoring_provider(),
            model=config.get_scoring_model()
        )
        
        scored_papers = await scorer.score_batch(papers)
        filtered_papers = scorer.filter_by_threshold(scored_papers)
        
        # Store to JSON storage
        storage = get_json_storage()
        for sp in filtered_papers:
            paper_dict = scored_paper_to_db_dict(sp)
            storage.upsert_paper(paper_dict)
        
        # Create notifications for high-score papers
        for sp in filtered_papers:
            notification = NotificationResponse(
                id=f"notif-{sp.paper.id}",
                paper_id=sp.paper.id,
                title=sp.paper.title,
                source=sp.paper.source,
                score=sp.total_score,
                timestamp=datetime.now(timezone.utc),
            )
            _notification_queue.append(notification)
        
        return {
            "success": True,
            "scored_count": len(scored_papers),
            "filtered_count": len(filtered_papers),
            "papers": [
                {
                    "id": sp.paper.id,
                    "title": sp.paper.title,
                    "total_score": sp.total_score,
                    "one_liner": sp.one_liner,
                }
                for sp in filtered_papers
            ],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@papers_router.post("/save")
async def save_paper(request: SavePaperRequest, config=Depends(get_config)):
    """Save a paper for later reading.
    
    Requirements: 7.3 - "稍后读" functionality
    """
    try:
        logger.info(f"Saving paper {request.paper_id} for user {request.user_id}")
        storage = get_json_storage()
        result = storage.save_paper_for_later(request.paper_id, request.user_id)
        
        # Check if paper was already saved
        if result.get('already_saved', False):
            logger.info(f"Paper {request.paper_id} was already saved")
            return SavePaperResponse(success=False, message="Paper already saved")
        else:
            logger.info(f"Paper saved successfully: {result}")
            return SavePaperResponse(success=True, message="Paper saved successfully")
    except Exception as e:
        logger.error(f"Error saving paper {request.paper_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Chat endpoints
@chat_router.post("/message", response_model=ChatMessageResponse)
async def send_chat_message(request: ChatMessageRequest, config=Depends(get_config)):
    """Send a chat message about a paper with RAG support.
    
    Requirements: 8.1, 8.2, 8.5, 8.9 - RAG chat with PDF context and fallback
    """
    chat_api_key = config.get_chat_api_key()
    if not chat_api_key:
        raise HTTPException(status_code=400, detail="Chat API key not configured")
    
    try:
        from openai import AsyncOpenAI
        from ..scorer.llm_scorer import PROVIDER_CONFIGS
        
        rag_service = get_rag_service()
        
        # Get paper context from JSON storage
        storage = get_json_storage()
        paper_data = storage.get_paper_by_id(request.paper_id)
        
        if not paper_data:
            # Try to find in memory cache
            for p in _papers_cache:
                if p.id == request.paper_id:
                    paper_data = {
                        "title": p.title,
                        "abstract": p.abstract,
                        "arxiv_id": p.id
                    }
                    break
        
        if not paper_data:
            raise HTTPException(status_code=404, detail="Paper not found")
        
        # Get or initialize RAG context
        rag_context = rag_service.get_context(request.paper_id)
        if not rag_context:
            # Initialize context with abstract-only mode
            rag_context = await rag_service.initialize_context(
                paper_id=request.paper_id,
                paper_title=paper_data.get('title', ''),
                paper_abstract=paper_data.get('abstract', ''),
                pdf_url=""  # No PDF URL means abstract-only mode
            )
        
        # Try to get enhanced context from PDF if available
        context_text = paper_data.get('abstract', '')
        context_source = "摘要"
        is_pdf_based = False
        
        if rag_context.is_pdf_processed:
            # Perform semantic search for relevant chunks
            search_results = rag_service.search_semantic(
                paper_id=request.paper_id,
                query=request.message,
                top_k=3
            )
            
            if search_results:
                # Use RAG context
                context_text = rag_context.get_context_text(max_tokens=3000)
                context_source = "PDF全文"
                is_pdf_based = True
        
        # Get provider config
        provider = config.llm_provider
        provider_config = PROVIDER_CONFIGS.get(provider, PROVIDER_CONFIGS["openrouter"])
        
        # Initialize client based on provider
        client_kwargs = {"api_key": chat_api_key}
        if provider_config["base_url"]:
            client_kwargs["base_url"] = provider_config["base_url"]
        
        client = AsyncOpenAI(**client_kwargs)
        model = config.llm_model or provider_config["model"]
        
        # Build conversation with enhanced context
        system_prompt = f"""你是一位专业的AI研究助手。用户正在阅读以下论文，请帮助他们理解论文内容。

论文标题: {paper_data.get('title', '')}

上下文来源: {context_source}
{context_text}

请用中文回答用户的问题，保持专业但易于理解。如果问题涉及论文中的具体细节，请尽量引用上下文中的相关内容。"""
        
        messages = [{"role": "system", "content": system_prompt}]
        
        # Add conversation history
        for msg in request.history:
            messages.append({
                "role": msg.get("role", "user"),
                "content": msg.get("content", ""),
            })
        
        # Add current message
        messages.append({"role": "user", "content": request.message})
        
        # Build request kwargs
        request_kwargs = {
            "model": model,
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 1000,
        }
        
        # Add extra headers for OpenRouter
        if provider == "openrouter":
            request_kwargs["extra_headers"] = provider_config.get("extra_headers", {})
        
        response = await client.chat.completions.create(**request_kwargs)
        
        # Add source indicator to the response
        response_content = response.choices[0].message.content
        
        if is_pdf_based:
            # PDF-based response
            response_content += "\n\n📄 **本回复基于PDF全文内容**"
        else:
            # Abstract-based response
            response_content += "\n\n📝 **本回复仅基于论文摘要，可能存在幻觉**"
        
        return ChatMessageResponse(
            role="assistant",
            content=response_content,
            timestamp=datetime.now(timezone.utc),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@chat_router.post("/quick-command", response_model=ChatMessageResponse)
async def execute_quick_command(request: QuickCommandRequest, config=Depends(get_config)):
    """Execute a quick command for a paper with PDF content search.
    
    Requirements: 8.3, 8.6 - Enhanced quick commands with PDF content
    """
    chat_api_key = config.get_chat_api_key()
    if not chat_api_key:
        raise HTTPException(status_code=400, detail="Chat API key not configured")
    
    try:
        from openai import AsyncOpenAI
        from ..scorer.llm_scorer import PROVIDER_CONFIGS
        
        rag_service = get_rag_service()
        
        # Get paper context from JSON storage
        storage = get_json_storage()
        paper_data = storage.get_paper_by_id(request.paper_id)
        
        if not paper_data:
            # Try to find in memory cache
            for p in _papers_cache:
                if p.id == request.paper_id:
                    paper_data = {
                        "title": p.title,
                        "abstract": p.abstract,
                        "url": p.url,
                        "arxiv_id": p.id
                    }
                    break
        
        if not paper_data:
            raise HTTPException(status_code=404, detail="Paper not found")
        
        # Get RAG context
        rag_context = rag_service.get_context(request.paper_id)
        
        # Prepare command-specific search and context
        context_text = paper_data.get('abstract', '')
        context_source = "摘要"
        is_pdf_based = False
        
        if rag_context and rag_context.is_pdf_processed:
            # Perform targeted search based on command
            if request.command == "看公式":
                # Search for mathematical content
                search_results = rag_service.search_keyword(
                    paper_id=request.paper_id,
                    keywords=["equation", "formula", "mathematical", "算法", "公式", "方程", "数学", "计算"],
                    top_k=3
                )
            elif request.command == "看代码链接":
                # Search for code-related content
                search_results = rag_service.search_keyword(
                    paper_id=request.paper_id,
                    keywords=["code", "github", "implementation", "代码", "实现", "开源", "repository"],
                    top_k=3
                )
            else:
                search_results = []
            
            if search_results:
                # Build enhanced context from search results
                context_parts = [f"论文标题: {paper_data.get('title', '')}"]
                context_parts.append(f"论文摘要: {paper_data.get('abstract', '')}")
                context_parts.append("\n相关PDF内容:")
                
                for result in search_results:
                    chunk = result.chunk
                    context_parts.append(f"\n[第{chunk.page_number}页] {chunk.content}")
                
                context_text = "\n".join(context_parts)
                context_source = "PDF全文搜索"
                is_pdf_based = True
        
        # Get provider config
        provider = config.llm_provider
        provider_config = PROVIDER_CONFIGS.get(provider, PROVIDER_CONFIGS["openrouter"])
        
        # Initialize client based on provider
        client_kwargs = {"api_key": chat_api_key}
        if provider_config["base_url"]:
            client_kwargs["base_url"] = provider_config["base_url"]
        
        client = AsyncOpenAI(**client_kwargs)
        model = config.llm_model or provider_config["model"]
        
        # Build command-specific prompt
        if request.command == "看公式":
            prompt = f"""请从以下论文内容中提取并解释主要的数学公式或方法论。

上下文来源: {context_source}
{context_text}

请用中文解释论文中涉及的关键公式和数学概念。如果内容中有具体的公式，请详细解释其含义和作用。"""
        elif request.command == "看代码链接":
            prompt = f"""请帮助用户找到这篇论文相关的代码资源。

论文标题: {paper_data.get('title', '')}
论文URL: {paper_data.get('url', '')}

上下文来源: {context_source}
{context_text}

请提供：
1. 如何在论文页面找到代码链接
2. 常见的代码托管平台（如GitHub）上搜索该论文代码的建议
3. 相关的开源实现或复现项目的搜索建议
4. 如果PDF内容中提到了具体的代码仓库或实现，请特别指出"""
        else:
            raise HTTPException(status_code=400, detail=f"Unknown command: {request.command}")
        
        # Build request kwargs
        request_kwargs = {
            "model": model,
            "messages": [
                {"role": "system", "content": "你是一位专业的AI研究助手，帮助用户理解和探索学术论文。"},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.7,
            "max_tokens": 1000,
        }
        
        # Add extra headers for OpenRouter
        if provider == "openrouter":
            request_kwargs["extra_headers"] = provider_config.get("extra_headers", {})
        
        response = await client.chat.completions.create(**request_kwargs)
        
        # Add source indicator to the response
        response_content = response.choices[0].message.content
        
        if is_pdf_based:
            # PDF-based response
            response_content += "\n\n📄 **本回复基于PDF全文内容**"
        else:
            # Abstract-based response
            response_content += "\n\n📝 **本回复仅基于论文摘要，可能存在幻觉**"
        
        return ChatMessageResponse(
            role="assistant",
            content=response_content,
            timestamp=datetime.now(timezone.utc),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Notifications endpoints
@notifications_router.get("/", response_model=NotificationListResponse)
async def get_notifications():
    """Get pending notifications.
    
    Requirements: 6.1, 6.5 - Bubble notifications for high-score papers
    """
    global _notification_queue
    return NotificationListResponse(notifications=_notification_queue)


@notifications_router.delete("/{notification_id}")
async def dismiss_notification(notification_id: str):
    """Dismiss a notification.
    
    Requirements: 6.4 - Dismiss notifications
    """
    global _notification_queue
    _notification_queue = [n for n in _notification_queue if n.id != notification_id]
    return {"success": True}


@notifications_router.delete("/")
async def clear_notifications():
    """Clear all notifications."""
    global _notification_queue
    _notification_queue = []
    return {"success": True}


# PDF processing endpoints
@pdf_router.post("/process", response_model=PDFProcessingResponse)
async def process_pdf(request: PDFProcessingRequest, config=Depends(get_config)):
    """Start PDF processing for a paper with error handling and fallback.
    
    Requirements: 8.1, 8.2, 8.3, 8.9 - PDF download, processing, vectorization, and fallback
    """
    try:
        rag_service = get_rag_service()
        
        # Get paper info from storage
        storage = get_json_storage()
        paper_data = storage.get_paper_by_id(request.paper_id)
        
        if not paper_data:
            # Try to find in memory cache
            for p in _papers_cache:
                if p.id == request.paper_id:
                    paper_data = {
                        "title": p.title,
                        "abstract": p.abstract,
                        "arxiv_id": p.id
                    }
                    break
        
        if not paper_data:
            raise HTTPException(status_code=404, detail="Paper not found")
        
        # Initialize RAG context (always succeeds with abstract)
        await rag_service.initialize_context(
            paper_id=request.paper_id,
            paper_title=paper_data.get("title", ""),
            paper_abstract=paper_data.get("abstract", ""),
            pdf_url=request.pdf_url
        )
        
        # Attempt PDF processing with error handling
        try:
            success = await rag_service.process_pdf_if_needed(request.paper_id)
            
            if success:
                # Get final status
                status = rag_service.get_processing_status(request.paper_id)
                return PDFProcessingResponse(
                    success=True,
                    message="PDF processing completed successfully",
                    chunks_count=status.get("total_chunks", 0)
                )
            else:
                # PDF processing failed, but context is still available with abstract
                return PDFProcessingResponse(
                    success=False,
                    message="PDF processing failed, but abstract-based chat is available"
                )
                
        except Exception as pdf_error:
            logger.warning(f"PDF processing failed for paper {request.paper_id}: {pdf_error}")
            
            # Return graceful failure - abstract-based chat is still available
            return PDFProcessingResponse(
                success=False,
                message=f"PDF processing failed: {str(pdf_error)}. Abstract-based chat is still available."
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"PDF processing request failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@pdf_router.post("/search", response_model=PDFSearchResponse)
async def search_pdf_content(request: PDFSearchRequest, config=Depends(get_config)):
    """Search within PDF content using text search with error handling.
    
    Requirements: 8.4, 8.9 - Vector search API with error handling
    """
    try:
        rag_service = get_rag_service()
        
        # Check if paper exists and is processed
        context = rag_service.get_context(request.paper_id)
        if not context:
            raise HTTPException(status_code=404, detail="Paper context not found")
        
        if not context.is_pdf_processed:
            raise HTTPException(
                status_code=400, 
                detail="PDF not processed for this paper. Only abstract-based search is available."
            )
        
        # Perform search based on type with error handling
        try:
            if request.search_type == "semantic":
                # Use text-based search (BM25-like scoring)
                results = rag_service.search_semantic(request.paper_id, request.query, request.top_k)
            elif request.search_type == "keyword":
                # Convert query to keywords
                keywords = request.query.split()
                results = rag_service.search_keyword(request.paper_id, keywords, request.top_k)
            else:
                raise HTTPException(status_code=400, detail="Invalid search type. Use 'semantic' or 'keyword'")
            
            # Convert results to API response format
            search_results = []
            for result in results:
                search_results.append(PDFSearchResult(
                    chunk_id=result.chunk.id,
                    content=result.chunk.content,
                    page_number=result.chunk.page_number,
                    relevance_score=result.relevance_score
                ))
            
            return PDFSearchResponse(
                paper_id=request.paper_id,
                query=request.query,
                search_type=request.search_type,
                results=search_results,
                total_results=len(search_results)
            )
            
        except Exception as search_error:
            logger.error(f"PDF search failed for paper {request.paper_id}: {search_error}")
            
            # Return empty results with error indication
            return PDFSearchResponse(
                paper_id=request.paper_id,
                query=request.query,
                search_type=request.search_type,
                results=[],
                total_results=0
            )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"PDF search request failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@pdf_router.post("/chat", response_model=ChatMessageResponse)
async def chat_with_pdf(request: PDFChatRequest, config=Depends(get_config)):
    """Chat with PDF content using RAG with fallback to abstract-based chat.
    
    Requirements: 8.5, 8.9 - PDF-based chat API with fallback behavior
    """
    chat_api_key = config.get_chat_api_key()
    if not chat_api_key:
        raise HTTPException(status_code=400, detail="Chat API key not configured")
    
    try:
        from openai import AsyncOpenAI
        from ..scorer.llm_scorer import PROVIDER_CONFIGS
        
        rag_service = get_rag_service()
        
        # Get RAG context
        context = rag_service.get_context(request.paper_id)
        if not context:
            raise HTTPException(status_code=404, detail="Paper context not found")
        
        # Determine context source and search for relevant chunks
        context_text = context.paper_abstract
        context_source = "摘要"
        is_pdf_based = False
        
        if context.is_pdf_processed:
            try:
                # Perform text search for relevant chunks
                search_results = rag_service.search_semantic(request.paper_id, request.message, top_k=3)
                
                if search_results:
                    # Update context with retrieved chunks
                    context.retrieved_chunks = [result.chunk for result in search_results]
                    context.last_query = request.message
                    context.last_search_time = datetime.now()
                    
                    # Get formatted context text from PDF
                    context_text = context.get_context_text(max_tokens=request.max_context_tokens)
                    context_source = "PDF全文"
                    is_pdf_based = True
                    
            except Exception as search_error:
                logger.warning(f"PDF search failed for paper {request.paper_id}: {search_error}")
                # Keep is_pdf_based = False for abstract-based response
        
        # Get provider config
        provider = config.llm_provider
        provider_config = PROVIDER_CONFIGS.get(provider, PROVIDER_CONFIGS["openrouter"])
        
        # Initialize client
        client_kwargs = {"api_key": chat_api_key}
        if provider_config["base_url"]:
            client_kwargs["base_url"] = provider_config["base_url"]
        
        client = AsyncOpenAI(**client_kwargs)
        model = config.llm_model or provider_config["model"]
        
        # Build system prompt with context
        system_prompt = f"""你是一位专业的AI研究助手。用户正在阅读以下论文，请帮助他们理解论文内容。

论文标题: {context.paper_title}

上下文来源: {context_source}
{context_text}

请用中文回答用户的问题，保持专业但易于理解。如果问题涉及论文中的具体细节，请尽量引用上下文中的相关内容。"""
        
        # Build conversation
        messages = [{"role": "system", "content": system_prompt}]
        
        # Add history
        for msg in request.history:
            messages.append({
                "role": msg.get("role", "user"),
                "content": msg.get("content", "")
            })
        
        # Add current message
        messages.append({"role": "user", "content": request.message})
        
        # Build request
        request_kwargs = {
            "model": model,
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 1000,
        }
        
        if provider == "openrouter":
            request_kwargs["extra_headers"] = provider_config.get("extra_headers", {})
        
        # Get response
        response = await client.chat.completions.create(**request_kwargs)
        
        # Add source indicator to the response
        response_content = response.choices[0].message.content
        
        if is_pdf_based:
            # PDF-based response
            response_content += "\n\n📄 **本回复基于PDF全文内容**"
        else:
            # Abstract-based response
            response_content += "\n\n📝 **本回复仅基于论文摘要，可能存在幻觉**"
        
        return ChatMessageResponse(
            role="assistant",
            content=response_content,
            timestamp=datetime.now(timezone.utc),
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"PDF chat failed: {e}")
        # Return a graceful error message
        return ChatMessageResponse(
            role="assistant",
            content=f"抱歉，聊天服务暂时不可用：{str(e)}。请稍后重试。",
            timestamp=datetime.now(timezone.utc),
        )


@pdf_router.get("/status", response_model=PDFStatusResponse)
async def get_pdf_status(paper_id: str):
    """Get PDF processing status for a paper.
    
    Requirements: 8.1 - PDF processing status display
    """
    try:
        logger.info(f"Getting PDF status for paper_id: '{paper_id}'")
        rag_service = get_rag_service()
        
        available_contexts = list(rag_service._contexts.keys())
        logger.debug(f"Available contexts: {available_contexts}")
        
        status = rag_service.get_processing_status(paper_id)
        logger.info(f"Retrieved status: {status}")
        
        return PDFStatusResponse(
            paper_id=paper_id,
            is_downloading=status.get("is_downloading", False),
            is_processing=status.get("is_processing", False),
            is_complete=status.get("is_complete", False),
            progress=status.get("progress", 0.0),
            error_message=status.get("error_message"),
            total_chunks=status.get("total_chunks", 0),
            processed_chunks=status.get("processed_chunks", 0),
            pdf_processed=status.get("pdf_processed", False),
            has_context=status.get("has_context", False)
        )
        
    except Exception as e:
        logger.error(f"Failed to get PDF status for paper_id '{paper_id}': {e}")
        raise HTTPException(status_code=500, detail=str(e))
