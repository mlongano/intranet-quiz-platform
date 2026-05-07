from contextlib import contextmanager
from typing import Generator
import os

from psycopg_pool import ConnectionPool
import psycopg

_pool: ConnectionPool | None = None


def init_pool(dsn: str | None = None, min_size: int = 2, max_size: int = 8) -> None:
    global _pool
    if dsn is None:
        dsn = os.environ.get('DATABASE_URL', 'postgresql:///quizparty')
    _pool = ConnectionPool(
        conninfo=dsn,
        min_size=min_size,
        max_size=max_size,
        open=True,
        kwargs={'autocommit': False},
    )


def get_pool() -> ConnectionPool:
    if _pool is None:
        raise RuntimeError("Database pool not initialized. Call db.init_pool() at startup.")
    return _pool


@contextmanager
def get_conn() -> Generator[psycopg.Connection, None, None]:
    with get_pool().connection() as conn:
        yield conn
