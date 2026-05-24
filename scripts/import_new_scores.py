"""
Import new-format scores from local-quizzies banks/scores_bank into the platform.

New-format score files contain a "question_snapshot" in every answer, making
them self-contained. Three such files exist:
  1. Architettura del Web e Astro – Fondamenti di Rendering e Async/Await (33 q, snapshot 38)
  2. OSPF, NAT, ACL e Fondamenti di VPN (43 q, snapshot 1)
  3. 3AI INFO 2Q - Esercizi fatti e OOP in Java (41 q, snapshot 51)

Usage:
    uv run scripts/import_new_scores.py
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

import commentjson
import psycopg
from dotenv import load_dotenv

load_dotenv()

DSN = os.environ.get("DATABASE_URL", "postgresql://localhost/quizparty")

# Bank files are copied into /tmp/ for Docker container access
BANK_DIR = "/tmp"
TEACHER_EMAIL = "mauro@oruam.org"  # super_admin

# Snapshot mapping: (db snapshot_id, filename suffix match, display name)
SCORE_FILES: list[tuple[int, str, str]] = [
    (38, "2026-03-24_17-32_4CI-TPSIT-risultati_architettura-del-web-e-astro-fondamenti-di-rendering-e-asyncawait", "Architettura del Web"),
    (1,  "2026-05-14_16-27_risultati_5CI-SER-RECUPERO-E-PRECEDENTI-NEW-ospf-nat-acl-e-fondamenti-di-vpn", "OSPF/NAT/ACL"),
    (51, "2026-05-20_10-22_risultati_3AI-INFO-2q-esercizi-fatti-e-oop-in-java", "3AI OOP"),
]

SCORES_JSONC = "/Users/mauro/Develop/_TeacherTools/local-quizzies/scores.jsonc"  # root level, same 17 entries for OSPF


def main() -> None:
    conn = psycopg.connect(DSN)
    conn.autocommit = False

    # Resolve teacher id
    teacher_row = conn.execute(
        "SELECT id FROM teachers WHERE email = %s", (TEACHER_EMAIL,),
    ).fetchone()
    if not teacher_row:
        print(f"ERROR: Teacher {TEACHER_EMAIL} not found")
        sys.exit(1)
    teacher_id = teacher_row[0]

    # Build student cache: email -> id (create missing students)
    student_cache: dict[str, int] = {}
    existing = conn.execute("SELECT id, email FROM students").fetchall()
    for row in existing:
        student_cache[row[1]] = row[0]

    total_sessions = 0
    total_entries = 0

    for snapshot_id, file_prefix, label in SCORE_FILES:
        filepath = os.path.join(BANK_DIR, file_prefix + ".jsonc")
        if not os.path.exists(filepath):
            print(f"SKIP {label}: file not found")
            continue

        scores_data = commentjson.loads(open(filepath, "r", encoding="utf-8").read())
        if not isinstance(scores_data, list) or len(scores_data) == 0:
            print(f"SKIP {label}: empty data")
            continue

        quiz_title = scores_data[0].get("quiz_title", file_prefix)
        print(f"\n{'='*60}")
        print(f"Importing: {label} → snapshot {snapshot_id}")
        print(f"  Title: {quiz_title}")
        print(f"  {len(scores_data)} score entries")

        # Find earliest timestamp for session creation
        earliest_ts = datetime.now(timezone.utc)
        for entry in scores_data:
            ts_str = entry.get("timestamp")
            if ts_str:
                try:
                    ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    if ts < earliest_ts:
                        earliest_ts = ts
                except Exception:
                    pass

        # Create synthetic closed session (no class attached)
        session_id = None
        session_row = conn.execute(
            """INSERT INTO quiz_sessions
                   (teacher_id, snapshot_id, title, status, created_at, opens_at)
               VALUES (%s, %s, %s, 'closed', %s, %s)
               RETURNING id""",
            (teacher_id, snapshot_id, f"Migrated — {quiz_title}", earliest_ts, earliest_ts),
        ).fetchone()
        if session_row:
            session_id = session_row[0]
            total_sessions += 1
        else:
            print(f"  ERROR creating session — no id returned")
            conn.rollback()
            continue

        entries_in_session = 0
        for entry in scores_data:
            email = (entry.get("student") or "").lower().strip()
            if not email:
                continue

            # Resolve or create student
            sid = student_cache.get(email)
            if sid is None:
                existing = conn.execute(
                    "SELECT id FROM students WHERE email = %s", (email,),
                ).fetchone()
                if existing:
                    sid = existing[0]
                else:
                    display_name = email.split("@")[0]
                    row = conn.execute(
                        "INSERT INTO students (email, display_name) VALUES (%s, %s) RETURNING id",
                        (email, display_name),
                    ).fetchone()
                    sid = row[0]
                    print(f"  Created student: {email}")
                student_cache[email] = sid

            # Parse timestamp
            ts_str = entry.get("timestamp")
            submitted_at = datetime.now(timezone.utc)
            if ts_str:
                try:
                    submitted_at = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                except Exception:
                    pass

            answers = entry.get("answers", [])

            conn.execute(
                """INSERT INTO score_entries
                       (session_id, student_id, teacher_id,
                        raw_points, max_points, percent, answers, submitted_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (session_id, student_id) DO NOTHING""",
                (
                    session_id, sid, teacher_id,
                    entry.get("raw_points", 0),
                    entry.get("max_points", 100),
                    entry.get("percent", 0),
                    json.dumps(answers),
                    submitted_at,
                ),
            )
            total_entries += 1
            entries_in_session += 1

        conn.commit()
        print(f"  → Session {session_id}: {entries_in_session} score entries committed")

    print(f"\n{'='*60}")
    print(f"Done. Created {total_sessions} sessions, {total_entries} score entries.")
    conn.close()


if __name__ == "__main__":
    main()
