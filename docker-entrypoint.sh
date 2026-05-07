#!/bin/sh
set -e

# ── Wait for PostgreSQL ───────────────────────────────────────────────────────
echo "[entrypoint] Waiting for database..."
python - <<'PYEOF'
import os, sys, time
import psycopg

dsn = os.environ.get('DATABASE_URL', 'postgresql:///quizparty')
for attempt in range(1, 31):
    try:
        with psycopg.connect(dsn, connect_timeout=3) as conn:
            pass
        print(f"[entrypoint] Database ready.", flush=True)
        sys.exit(0)
    except psycopg.OperationalError as e:
        print(f"[entrypoint] Not ready ({e}), attempt {attempt}/30...", flush=True)
        time.sleep(2)

print("[entrypoint] ERROR: database not available after 60 s", file=sys.stderr)
sys.exit(1)
PYEOF

# ── Apply migrations ──────────────────────────────────────────────────────────
echo "[entrypoint] Running migrations..."
python -m db.migrate up

# ── Start server ──────────────────────────────────────────────────────────────
echo "[entrypoint] Starting QuizParty..."
exec python server.py
