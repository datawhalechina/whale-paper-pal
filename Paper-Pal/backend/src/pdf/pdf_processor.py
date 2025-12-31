"""PDF processing service for downloading, parsing, and chunking PDFs.

Requirements: 8.1, 8.2
"""

import logging
import re
import tempfile
from pathlib import Path
from typing import List, Optional
from urllib.parse import urlparse

try:
    import fitz  # PyMuPDF
    HAS_PYMUPDF = True
except ImportError:
    HAS_PYMUPDF = False
    fitz = None

import requests

from .models import DocumentChunk, PDFProcessingStatus

logger = logging.getLogger(__name__)


class PDFProcessor:
    """Handles PDF download, text extraction, and chunking."""
    
    def __init__(self):
        """Initialize PDF processor."""
        if not HAS_PYMUPDF:
            logger.warning("PyMuPDF not available - PDF processing will be disabled")
        self._processing_status: dict[str, PDFProcessingStatus] = {}
    
    def get_processing_status(self, paper_id: str) -> PDFProcessingStatus:
        """Get the processing status for a paper."""
        return self._processing_status.get(paper_id, PDFProcessingStatus(paper_id=paper_id))
    
    async def download_pdf(self, url: str, paper_id: str) -> bytes:
        """Download PDF from URL.
        
        Args:
            url: PDF URL to download
            paper_id: Paper ID for status tracking
            
        Returns:
            PDF content as bytes
            
        Raises:
            ValueError: If URL is invalid
            requests.RequestException: If download fails
        """
        # Update status
        status = self._processing_status.get(paper_id, PDFProcessingStatus(paper_id=paper_id))
        status.is_downloading = True
        status.progress = 0.0
        self._processing_status[paper_id] = status
        
        try:
            # Validate URL
            parsed_url = urlparse(url)
            if not parsed_url.scheme or not parsed_url.netloc:
                raise ValueError(f"Invalid URL: {url}")
            
            # Convert ArXiv abstract URL to PDF URL if needed
            if "arxiv.org/abs/" in url:
                url = url.replace("/abs/", "/pdf/") + ".pdf"
            
            logger.info(f"Downloading PDF from: {url}")
            
            # Download with streaming to track progress
            response = requests.get(url, stream=True, timeout=30)
            response.raise_for_status()
            
            # Check content type
            content_type = response.headers.get('content-type', '').lower()
            if 'application/pdf' not in content_type and not url.endswith('.pdf'):
                logger.warning(f"Unexpected content type: {content_type}")
            
            # Download content
            content = b""
            total_size = int(response.headers.get('content-length', 0))
            
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    content += chunk
                    if total_size > 0:
                        status.progress = len(content) / total_size * 0.5  # 50% for download
                        self._processing_status[paper_id] = status
            
            status.is_downloading = False
            status.progress = 0.5
            self._processing_status[paper_id] = status
            
            logger.info(f"Downloaded PDF: {len(content)} bytes")
            return content
            
        except Exception as e:
            status.is_downloading = False
            status.error_message = f"Download failed: {str(e)}"
            self._processing_status[paper_id] = status
            logger.error(f"Failed to download PDF from {url}: {e}")
            raise
    
    def extract_text(self, pdf_content: bytes, paper_id: str) -> str:
        """Extract text from PDF content.
        
        Args:
            pdf_content: PDF content as bytes
            paper_id: Paper ID for status tracking
            
        Returns:
            Extracted text content
            
        Raises:
            ValueError: If PDF is invalid or empty
            ImportError: If PyMuPDF is not available
        """
        if not HAS_PYMUPDF:
            raise ImportError("PyMuPDF is required for PDF text extraction")
            
        status = self._processing_status.get(paper_id, PDFProcessingStatus(paper_id=paper_id))
        status.is_processing = True
        self._processing_status[paper_id] = status
        
        try:
            # Create temporary file for PyMuPDF
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_file:
                temp_file.write(pdf_content)
                temp_path = temp_file.name
            
            try:
                # Open PDF with PyMuPDF
                doc = fitz.open(temp_path)
                
                if doc.page_count == 0:
                    raise ValueError("PDF has no pages")
                
                page_count = doc.page_count  # Store page count before closing
                text_content = ""
                for page_num in range(page_count):
                    page = doc[page_num]
                    page_text = page.get_text()
                    text_content += f"\n--- Page {page_num + 1} ---\n{page_text}"
                    
                    # Update progress
                    status.progress = 0.5 + (page_num + 1) / page_count * 0.3  # 30% for extraction
                    self._processing_status[paper_id] = status
                
                doc.close()
                
                if not text_content.strip():
                    raise ValueError("No text content extracted from PDF")
                
                logger.info(f"Extracted text: {len(text_content)} characters from {page_count} pages")
                return text_content
                
            finally:
                # Clean up temporary file
                Path(temp_path).unlink(missing_ok=True)
                
        except Exception as e:
            status.error_message = f"Text extraction failed: {str(e)}"
            self._processing_status[paper_id] = status
            logger.error(f"Failed to extract text from PDF: {e}")
            raise
    
    def chunk_text(self, text: str, paper_id: str, chunk_size: int = 1000, overlap: int = 200) -> List[DocumentChunk]:
        """Split text into overlapping chunks.
        
        Args:
            text: Text content to chunk
            paper_id: Paper ID for the chunks
            chunk_size: Maximum characters per chunk
            overlap: Number of characters to overlap between chunks
            
        Returns:
            List of DocumentChunk objects
        """
        status = self._processing_status.get(paper_id, PDFProcessingStatus(paper_id=paper_id))
        
        try:
            if not text.strip():
                raise ValueError("Text content is empty")
            
            chunks = []
            chunk_index = 0
            start = 0
            
            # Extract page markers to track page numbers
            page_pattern = r'\n--- Page (\d+) ---\n'
            page_markers = list(re.finditer(page_pattern, text))
            
            while start < len(text):
                # Calculate end position
                end = min(start + chunk_size, len(text))
                
                # Try to break at sentence boundary if possible
                if end < len(text):
                    # Look for sentence endings within the last 100 characters
                    search_start = max(start, end - 100)
                    sentence_end = -1
                    
                    for pattern in [r'\.\s+', r'\!\s+', r'\?\s+', r'\n\n']:
                        matches = list(re.finditer(pattern, text[search_start:end]))
                        if matches:
                            sentence_end = search_start + matches[-1].end()
                            break
                    
                    if sentence_end > start:
                        end = sentence_end
                
                # Extract chunk content
                chunk_content = text[start:end].strip()
                
                if chunk_content:
                    # Determine page number for this chunk
                    page_number = 1
                    for marker in page_markers:
                        if marker.start() <= start:
                            page_number = int(marker.group(1))
                        else:
                            break
                    
                    # Create chunk
                    chunk = DocumentChunk(
                        id=f"{paper_id}_chunk_{chunk_index}",
                        paper_id=paper_id,
                        chunk_index=chunk_index,
                        content=chunk_content,
                        page_number=page_number
                    )
                    chunks.append(chunk)
                    chunk_index += 1
                
                # Move to next chunk with overlap
                start = max(start + 1, end - overlap)
                
                # Update progress
                status.progress = 0.8 + (start / len(text)) * 0.1  # 10% for chunking
                self._processing_status[paper_id] = status
            
            status.total_chunks = len(chunks)
            self._processing_status[paper_id] = status
            
            logger.info(f"Created {len(chunks)} chunks for paper {paper_id}")
            return chunks
            
        except Exception as e:
            status.error_message = f"Text chunking failed: {str(e)}"
            self._processing_status[paper_id] = status
            logger.error(f"Failed to chunk text: {e}")
            raise
    
    def generate_embeddings(self, chunks: List[DocumentChunk], paper_id: str) -> List[DocumentChunk]:
        """Generate vector embeddings for text chunks (deprecated - using keyword search instead).
        
        Args:
            chunks: List of DocumentChunk objects
            paper_id: Paper ID for status tracking
            
        Returns:
            List of DocumentChunk objects (embeddings not generated)
        """
        status = self._processing_status.get(paper_id, PDFProcessingStatus(paper_id=paper_id))
        
        try:
            # Skip embedding generation - using keyword search instead
            for i, chunk in enumerate(chunks):
                chunk.embedding = None  # No embeddings needed
                status.processed_chunks = i + 1
                status.progress = 0.9 + (i + 1) / len(chunks) * 0.1  # Final 10% for processing
                self._processing_status[paper_id] = status
            
            logger.info(f"Processed {len(chunks)} chunks for keyword search (no embeddings)")
            return chunks
            
        except Exception as e:
            status.error_message = f"Chunk processing failed: {str(e)}"
            self._processing_status[paper_id] = status
            logger.error(f"Failed to process chunks: {e}")
            raise
    
    async def process_pdf(self, url: str, paper_id: str) -> List[DocumentChunk]:
        """Complete PDF processing pipeline.
        
        Args:
            url: PDF URL to process
            paper_id: Paper ID for tracking
            
        Returns:
            List of DocumentChunk objects ready for keyword search
        """
        try:
            # Initialize status
            status = PDFProcessingStatus(paper_id=paper_id)
            self._processing_status[paper_id] = status
            
            # Download PDF
            pdf_content = await self.download_pdf(url, paper_id)
            
            # Extract text
            text_content = self.extract_text(pdf_content, paper_id)
            
            # Chunk text
            chunks = self.chunk_text(text_content, paper_id)
            
            # Process chunks (no embeddings needed for keyword search)
            processed_chunks = self.generate_embeddings(chunks, paper_id)
            
            # Mark as complete
            status.is_complete = True
            status.progress = 1.0
            self._processing_status[paper_id] = status
            
            logger.info(f"PDF processing complete for paper {paper_id}: {len(processed_chunks)} chunks")
            return processed_chunks
            
        except Exception as e:
            status = self._processing_status.get(paper_id, PDFProcessingStatus(paper_id=paper_id))
            status.error_message = f"PDF processing failed: {str(e)}"
            status.is_downloading = False
            status.is_processing = False
            self._processing_status[paper_id] = status
            logger.error(f"PDF processing failed for paper {paper_id}: {e}")
            raise