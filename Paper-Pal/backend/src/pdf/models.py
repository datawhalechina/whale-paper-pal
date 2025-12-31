"""PDF processing data models.

Requirements: 8.2, 8.3
"""

from dataclasses import dataclass
from typing import List, Optional


@dataclass
class DocumentChunk:
    """Represents a chunk of text from a PDF document."""
    
    id: str
    paper_id: str
    chunk_index: int
    content: str
    page_number: int
    embedding: Optional[List[float]] = None
    
    def __post_init__(self):
        """Validate chunk data."""
        if not self.content.strip():
            raise ValueError("Document chunk content cannot be empty")
        if self.chunk_index < 0:
            raise ValueError("Chunk index must be non-negative")
        if self.page_number < 1:
            raise ValueError("Page number must be positive")


@dataclass
class PDFProcessingStatus:
    """Represents the status of PDF processing."""
    
    paper_id: str
    is_downloading: bool = False
    is_processing: bool = False
    is_complete: bool = False
    progress: float = 0.0  # 0.0 to 1.0
    error_message: Optional[str] = None
    total_chunks: int = 0
    processed_chunks: int = 0