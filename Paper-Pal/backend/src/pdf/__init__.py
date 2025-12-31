"""PDF processing module for Paper Pal.

This module handles PDF download, text extraction, chunking, and text-based search.
Requirements: 8.1, 8.2, 8.3
"""

from .pdf_processor import PDFProcessor
from .vector_store import TextStore, VectorStore  # VectorStore is alias for backward compatibility
from .models import DocumentChunk, PDFProcessingStatus

__all__ = ["PDFProcessor", "TextStore", "VectorStore", "DocumentChunk", "PDFProcessingStatus"]