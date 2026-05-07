"""
First-run admin bootstrap.

Usage:
    python -m db.bootstrap_admin

Creates the first super_admin account. Aborts if any teacher row already exists.
"""

import getpass
import os
import sys
from pathlib import Path

import bcrypt
import psycopg
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / '.env')


def main() -> None:
    dsn = os.environ.get('DATABASE_URL', 'postgresql:///quizparty')

    with psycopg.connect(dsn) as conn:
        count = conn.execute("SELECT COUNT(*) FROM teachers").fetchone()[0]
        if count > 0:
            print(f"ERROR: {count} teacher(s) already exist. Bootstrap is only for a fresh DB.")
            print("Use the super-admin UI to add more accounts.")
            sys.exit(1)

        print("=== QuizParty — Super-Admin Bootstrap ===")
        email = input("Super-admin email: ").strip().lower()
        display_name = input("Display name (or Enter to use email): ").strip() or email

        while True:
            pw = getpass.getpass("Password (min 8 chars): ")
            if len(pw) < 8:
                print("Password must be at least 8 characters.")
                continue
            pw2 = getpass.getpass("Confirm password: ")
            if pw != pw2:
                print("Passwords do not match.")
                continue
            break

        pw_hash = bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=12)).decode()
        row = conn.execute(
            """INSERT INTO teachers
                   (email, display_name, role, password_hash, password_must_change, status)
               VALUES (%s, %s, 'super_admin', %s, FALSE, 'active')
               RETURNING id""",
            (email, display_name, pw_hash),
        ).fetchone()
        conn.commit()

    print(f"\n✓ Super-admin created: {email} (id={row[0]})")
    print("You can now start the server and log in.")


if __name__ == '__main__':
    main()
