"""
Migration runner.

Usage:
    python -m db.migrate up        # apply all pending migrations
    python -m db.migrate status    # print applied / pending
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv
import psycopg

MIGRATIONS_DIR = Path(__file__).parent / 'migrations'


def _get_dsn() -> str:
    load_dotenv(Path(__file__).parent.parent / '.env')
    return os.environ.get('DATABASE_URL', 'postgresql:///quizparty')


def _ensure_tracking_table(conn: psycopg.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version    TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    conn.commit()


def _applied_versions(conn: psycopg.Connection) -> set[str]:
    rows = conn.execute("SELECT version FROM schema_migrations").fetchall()
    return {r[0] for r in rows}


def _all_migration_files() -> list[Path]:
    files = sorted(MIGRATIONS_DIR.glob('*.sql'))
    return files


def run_up(dsn: str) -> None:
    with psycopg.connect(dsn, autocommit=False) as conn:
        _ensure_tracking_table(conn)
        applied = _applied_versions(conn)
        pending = [f for f in _all_migration_files() if f.stem not in applied]
        if not pending:
            print("All migrations already applied.")
            return
        for f in pending:
            print(f"Applying {f.name} ... ", end='', flush=True)
            sql = f.read_text()
            conn.execute(sql)
            conn.execute(
                "INSERT INTO schema_migrations (version) VALUES (%s)", (f.stem,)
            )
            conn.commit()
            print("done")


def run_status(dsn: str) -> None:
    with psycopg.connect(dsn, autocommit=True) as conn:
        _ensure_tracking_table(conn)
        applied = _applied_versions(conn)
    for f in _all_migration_files():
        mark = "✓" if f.stem in applied else "✗ pending"
        print(f"  {mark}  {f.name}")


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'up'
    dsn = _get_dsn()
    if cmd == 'up':
        run_up(dsn)
    elif cmd == 'status':
        run_status(dsn)
    else:
        print(f"Unknown command: {cmd}. Use 'up' or 'status'.", file=sys.stderr)
        sys.exit(1)
