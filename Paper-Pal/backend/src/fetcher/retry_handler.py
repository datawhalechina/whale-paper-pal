"""Simple retry handler for network operations."""

import asyncio
import logging
from typing import Callable, Any, TypeVar, Optional

logger = logging.getLogger(__name__)

T = TypeVar('T')


class ArXivAPIError(Exception):
    """Raised when ArXiv API fails."""
    pass


class RetryHandler:
    """Simple retry handler with exponential backoff."""
    
    def __init__(self, timeout: float = 30.0):
        """Initialize retry handler with configuration.
        
        Args:
            timeout: Request timeout in seconds
        """
        self.max_retries = 3  # Simple fixed retry count
        self.base_delay = 1.0  # Start with 1 second delay
        self.max_delay = 10.0  # Maximum delay between retries
        self.timeout = timeout
    
    async def execute_with_retry(
        self, 
        func: Callable[..., T], 
        *args, 
        **kwargs
    ) -> T:
        """Execute a function with retry logic.
        
        Args:
            func: Function to execute
            *args: Positional arguments for the function
            **kwargs: Keyword arguments for the function
            
        Returns:
            Result of the function call
            
        Raises:
            ArXivAPIError: When all retries are exhausted
        """
        last_exception = None
        
        for attempt in range(self.max_retries + 1):
            try:
                logger.debug(f"Attempt {attempt + 1}/{self.max_retries + 1}")
                
                # Execute with timeout
                if asyncio.iscoroutinefunction(func):
                    result = await asyncio.wait_for(
                        func(*args, **kwargs), 
                        timeout=self.timeout
                    )
                else:
                    result = func(*args, **kwargs)
                
                if attempt > 0:
                    logger.info(f"Operation succeeded on attempt {attempt + 1}")
                
                return result
                
            except Exception as e:
                last_exception = e
                logger.warning(f"Attempt {attempt + 1} failed: {e}")
                
                # Don't retry on the last attempt
                if attempt < self.max_retries:
                    delay = min(self.base_delay * (2 ** attempt), self.max_delay)
                    logger.info(f"Retrying in {delay} seconds...")
                    await asyncio.sleep(delay)
                    continue
                break
        
        # All retries exhausted
        logger.error(f"All {self.max_retries + 1} attempts failed. Last error: {last_exception}")
        raise ArXivAPIError(f"Operation failed after {self.max_retries + 1} attempts: {last_exception}")
    
    def execute_sync_with_retry(
        self, 
        func: Callable[..., T], 
        *args, 
        **kwargs
    ) -> T:
        """Execute a synchronous function with retry logic.
        
        Args:
            func: Synchronous function to execute
            *args: Positional arguments for the function
            **kwargs: Keyword arguments for the function
            
        Returns:
            Result of the function call
            
        Raises:
            ArXivAPIError: When all retries are exhausted
        """
        import time
        
        last_exception = None
        
        for attempt in range(self.max_retries + 1):
            try:
                logger.debug(f"Sync attempt {attempt + 1}/{self.max_retries + 1}")
                
                result = func(*args, **kwargs)
                
                if attempt > 0:
                    logger.info(f"Sync operation succeeded on attempt {attempt + 1}")
                
                return result
                
            except Exception as e:
                last_exception = e
                logger.warning(f"Sync attempt {attempt + 1} failed: {e}")
                
                # Don't retry on the last attempt
                if attempt < self.max_retries:
                    delay = min(self.base_delay * (2 ** attempt), self.max_delay)
                    logger.info(f"Retrying in {delay} seconds...")
                    time.sleep(delay)
                    continue
                break
        
        # All retries exhausted
        logger.error(f"All {self.max_retries + 1} sync attempts failed. Last error: {last_exception}")
        raise ArXivAPIError(f"Sync operation failed after {self.max_retries + 1} attempts: {last_exception}")