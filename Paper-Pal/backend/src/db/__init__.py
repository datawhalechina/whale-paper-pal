"""Database module for Paper Pal."""

from .json_storage import get_json_storage, JsonStorage

# Keep supabase imports for backward compatibility but prefer JSON storage
try:
    from .supabase_client import get_supabase_client, SupabaseClient
except Exception:
    get_supabase_client = None
    SupabaseClient = None

__all__ = ["get_json_storage", "JsonStorage", "get_supabase_client", "SupabaseClient"]
