"""API module for Paper Pal backend."""

from .server import app, create_app
from .routes import papers_router, chat_router, notifications_router, add_notification

__all__ = ["app", "create_app", "papers_router", "chat_router", "notifications_router", "add_notification"]
