"""FastAPI server for Paper Pal backend.

Requirements: 6.1, 7.2, 8.2
"""

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import List

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import papers_router, chat_router, notifications_router, pdf_router, add_notification
from ..scheduler import get_scheduler
from ..models import ScoredPaper
from ..config import load_config

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def on_high_score_papers(papers: List[ScoredPaper]):
    """Callback when NEW high-score papers are found.
    
    Papers passed here are already filtered to be NEW (not in storage before).
    """
    if papers:
        logger.info(f"Creating notifications for {len(papers)} NEW high-score papers")
        for paper in papers:
            add_notification(
                paper_id=paper.paper.id,
                title=paper.paper.title,
                source=paper.paper.source,
                score=paper.total_score
            )
    else:
        logger.info("No new high-score papers to notify")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    # Startup
    config = load_config()
    logger.info("Paper Pal API starting...")
    logger.info(f"Auto fetch enabled: {config.auto_fetch_enabled}")
    logger.info(f"Fetch interval: {config.fetch_interval_minutes} minutes")
    logger.info(f"Score threshold: {config.score_threshold}")
    
    # Start scheduler
    scheduler = get_scheduler()
    scheduler.set_notification_callback(on_high_score_papers)
    scheduler.start()
    
    yield
    
    # Shutdown
    logger.info("Paper Pal API shutting down...")
    scheduler.stop()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="Paper Pal API",
        description="Backend API for Paper Pal - AI Paper Reading Assistant",
        version="1.0.0",
        lifespan=lifespan,
    )
    
    # Configure CORS for Electron app
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Allow all origins for Electron
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Include routers
    app.include_router(papers_router)
    app.include_router(chat_router)
    app.include_router(notifications_router)
    app.include_router(pdf_router)
    
    @app.get("/")
    async def root():
        """Root endpoint."""
        config = load_config()
        scheduler = get_scheduler()
        return {
            "message": "Paper Pal API",
            "version": "1.0.0",
            "scheduler": {
                "running": scheduler.is_running,
                "last_fetch": scheduler.last_fetch_time.isoformat() if scheduler.last_fetch_time else None,
                "fetch_count": scheduler.fetch_count,
                "interval_minutes": config.fetch_interval_minutes,
            }
        }
    
    @app.get("/health")
    async def health():
        """Health check endpoint."""
        scheduler = get_scheduler()
        return {
            "status": "healthy",
            "scheduler_running": scheduler.is_running
        }
    
    return app


# Create app instance
app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
