"""
Daily Challenge seed logic for Word Territory.

Each UTC calendar date maps to a deterministic opening board index,
so every player worldwide sees the same board that day.
"""

import hashlib
from datetime import date, datetime, timezone

# Day 1 of the Daily Challenge series
EPOCH_DATE = date(2026, 1, 1)


def get_today_utc() -> str:
    """Return today's date string in UTC (YYYY-MM-DD)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def date_to_day_number(date_str: str) -> int:
    """Monotonically increasing challenge number (Day 1 = 2026-01-01)."""
    d = date.fromisoformat(date_str)
    return max(1, (d - EPOCH_DATE).days + 1)


def date_to_opening_idx(date_str: str) -> int:
    """SHA-256 of the date string → deterministic opening index."""
    h = hashlib.sha256(date_str.encode()).hexdigest()
    return int(h[:8], 16)
