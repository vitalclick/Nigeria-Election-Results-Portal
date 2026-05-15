"""Thin asyncpg connection pool used by the worker.

The pool is initialised at app startup. We deliberately keep raw SQL here -
the worker's queries are short and predictable, and an ORM would obscure
what's happening at the database boundary, which is sensitive territory
for an election platform.
"""

from __future__ import annotations

import asyncpg

from .config import settings

_pool: asyncpg.Pool | None = None


async def init_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            settings().database_url,
            min_size=2,
            max_size=20,
            command_timeout=30,
            statement_cache_size=0,
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DB pool not initialised. Call init_pool() at startup.")
    return _pool
