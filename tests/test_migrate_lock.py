"""Concurrent migration runs must serialise.

app and worker share an entrypoint that runs `migrate up`, and compose starts
them together on every deploy. Without a lock both can see the same migration
as pending: the second blocks behind the first's transaction, then fails on
the objects the first created, and set -e kills that container — healed only
by the restart policy, through a crash.
"""

import os
import threading

import psycopg
import pytest

from db import migrate

PROBE = '999_race_probe'


@pytest.fixture
def probe_migration(tmp_path, monkeypatch):
    # A slow migration widens the window: the second run reads "pending" while
    # the first is still inside its transaction.
    (tmp_path / f'{PROBE}.sql').write_text(
        "CREATE TABLE race_probe (id int); SELECT pg_sleep(0.5);"
    )
    monkeypatch.setattr(migrate, 'MIGRATIONS_DIR', tmp_path)
    dsn = os.environ['TEST_DATABASE_URL']
    yield dsn
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("DROP TABLE IF EXISTS race_probe")
        conn.execute("DELETE FROM schema_migrations WHERE version = %s", (PROBE,))


def test_two_concurrent_runs_apply_a_migration_once(probe_migration):
    errors = []

    def run():
        try:
            migrate.run_up(probe_migration)
        except Exception as exc:  # noqa: BLE001 - surfaced by the assert below
            errors.append(exc)

    threads = [threading.Thread(target=run) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    assert errors == [], f"a concurrent run failed: {errors!r}"
    with psycopg.connect(probe_migration) as conn:
        applied = conn.execute(
            "SELECT count(*) FROM schema_migrations WHERE version = %s", (PROBE,)
        ).fetchone()[0]
    assert applied == 1
