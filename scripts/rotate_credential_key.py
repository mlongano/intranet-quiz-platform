#!/usr/bin/env python3
"""Rotate CREDENTIAL_ENCRYPTION_KEY, re-encrypting every stored teacher API key.

Run this BEFORE replacing the key in the environment. Once the old key is gone
the ciphertexts are unreadable and every teacher has to enter their API key
again — this script is the only thing standing between a key rotation and that
outcome.

The whole rotation happens in one transaction: either every credential moves to
the new key or none does. A partial rotation would leave rows that neither key
can decrypt.

Usage:

    # 1. generate the new key
    docker compose exec app python scripts/rotate_credential_key.py --generate

    # 2. re-encrypt (old key from the environment, new key passed in)
    docker compose exec app python scripts/rotate_credential_key.py \\
        --new-key '<the generated key>'

    # 3. put the new key in .env / the Docker secret, then restart app + worker

Add --dry-run to verify every credential can be decrypted without writing.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import db  # noqa: E402
from services import credentials  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--generate', action='store_true',
                        help='print a fresh master key and exit')
    parser.add_argument('--new-key', help='the key to re-encrypt to')
    parser.add_argument('--old-key',
                        help=f'the current key (defaults to ${credentials.MASTER_KEY_ENV})')
    parser.add_argument('--dry-run', action='store_true',
                        help='decrypt everything to prove it is readable, then roll back')
    args = parser.parse_args()

    if args.generate:
        print(credentials.generate_master_key())
        return 0

    if not args.new_key:
        parser.error('--new-key is required (or use --generate first)')

    old_key = args.old_key or os.getenv(credentials.MASTER_KEY_ENV, '')
    if not old_key:
        print(f"ERROR: no current key: set {credentials.MASTER_KEY_ENV} or pass --old-key",
              file=sys.stderr)
        return 1
    if old_key == args.new_key:
        print("ERROR: the new key is identical to the current one.", file=sys.stderr)
        return 1

    db.init_pool(dsn=os.environ.get('DATABASE_URL', 'postgresql:///quizparty'),
                 min_size=1, max_size=2)

    with db.get_conn() as conn:
        try:
            count = credentials.re_encrypt_all(old_key, args.new_key, conn)
        except credentials.CredentialEncryptionError as exc:
            conn.rollback()
            print(f"ERROR: {exc}", file=sys.stderr)
            print("Nothing was changed.", file=sys.stderr)
            return 1

        if args.dry_run:
            conn.rollback()
            print(f"Dry run: {count} credential(s) decrypt cleanly. Nothing written.")
            return 0

        conn.commit()

    print(f"Re-encrypted {count} credential(s).")
    print(f"Now set {credentials.MASTER_KEY_ENV} to the new key and restart app and worker.")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
