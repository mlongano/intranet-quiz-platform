# QuizParty Operations

This document records the supported deployment, backup, restore, and test
commands for the multi-teacher QuizParty platform.

## Supported Build Path

Docker Compose is the canonical production build path.

```bash
docker compose up -d --build
```

For development with Flask reload and Vite HMR:

```bash
docker compose -f compose.yaml -f compose-debug.yaml up -d --build
```

The debug override installs the `dev` Python extra into the app container, so
`pytest` is available there. The production image still installs runtime
dependencies only.

The host `pnpm build` path may fail if Rollup native optional dependencies are
stale on the host. The Docker frontend build is the supported gate:

```bash
docker compose exec frontend sh -c "cd /app && pnpm build"
```

## Tests

Backend:

```bash
scripts/run_tests_safe.sh tests/ -v --ignore=tests/test_migration.py
```

Never run pytest directly in the `app` container against the default `DATABASE_URL`. The test fixtures refuse non-test database names and the production schema also blocks accidental `TRUNCATE`, but the safe runner is the supported command.

Frontend:

```bash
docker compose exec frontend sh -c "cd /app && npx vitest run"
```

Production frontend build:

```bash
docker compose exec frontend sh -c "cd /app && pnpm build"
```

## LLM Open-Question Grading Prompts

Open-question LLM grading uses Markdown prompt files:

- `prompts/open-question-system.md`
- `prompts/open-question-user.md`

Override them with:

```env
LLM_OPEN_QUESTION_SYSTEM_PROMPT_PATH=prompts/open-question-system.md
LLM_OPEN_QUESTION_USER_PROMPT_PATH=prompts/open-question-user.md
```

The user prompt supports `{{QUESTION}}`, `{{ACCEPTABLE_ANSWER}}`, and
`{{STUDENT_ANSWER}}`.

LLM calls are guarded by a per-answer timeout. Tune it with:

```env
LLM_TIMEOUT_SECONDS=25
LLM_RETRIES=0
LLM_BACKOFF_FACTOR=0.5
```

## First Super-Admin

For a fresh database:

```bash
docker compose exec app python -m db.bootstrap_admin
```

The command aborts if any Teacher already exists. After the first Super-admin
exists, create and reset Teacher accounts from the Super-admin UI.

## Backups

Back up both PostgreSQL and uploaded images. PostgreSQL is the source of truth
for app data; the image volume stores files referenced by Quiz versions.

`compose.yaml` runs the `backup` service by default. It uses `scripts/backup_loop.sh` inside a `postgres:16-alpine` container and writes to the `app_backups` Docker volume:

```text
/backups/db/quizparty-YYYYMMDDTHHMMSSZ.dump
/backups/images/quizparty-images-YYYYMMDDTHHMMSSZ.tar.gz
/backups/manifests/quizparty-YYYYMMDDTHHMMSSZ.json
```

Default policy:

```bash
BACKUP_ON_START=1
BACKUP_INTERVAL_SECONDS=21600   # 6 hours
BACKUP_RETENTION_DAYS=30
```

Run an immediate backup:

```bash
docker compose run --rm backup sh /usr/local/bin/quizparty-backup once
```

Check backup logs:

```bash
docker compose logs backup --tail=100
```

## Production data-loss guard

Migration `004_block_production_truncate.sql` installs a `BEFORE TRUNCATE`
trigger on application tables. In databases whose name does not contain `test`,
TRUNCATE fails unless the current session explicitly sets:

```sql
SET quizparty.allow_destructive_maintenance = 'on';
```

This is a last-resort guard against test cleanup or ad-hoc maintenance commands
hitting the real `quizparty` database. Use the override only for a deliberate,
short-lived maintenance session.

## Restore

Use the restore script and do a dry-run first:

```bash
scripts/restore_backup.sh --dry-run --latest
```

Restore the latest automatic backup:

```bash
scripts/restore_backup.sh --latest --confirm RESTORE_QUIZPARTY
```

Restore explicit files:

```bash
scripts/restore_backup.sh \
  --db-dump /var/lib/docker/volumes/quizpartyplatform_app_backups/_data/db/quizparty-YYYYMMDDTHHMMSSZ.dump \
  --images-tar /var/lib/docker/volumes/quizpartyplatform_app_backups/_data/images/quizparty-images-YYYYMMDDTHHMMSSZ.tar.gz \
  --confirm RESTORE_QUIZPARTY
```

The script stops `app` and `worker`, restores PostgreSQL with `pg_restore`,
optionally replaces uploaded images from the tarball, and starts the stack again.

## Offline Operation

Google Workspace Sync requires internet only during the sync window. After
Teachers, Students, Classes, and memberships are stored locally, Quiz sessions
can run offline on the school intranet. JWT validation, Quiz plans, Score
entries, Snapshots, and images are local.

Email delivery and LLM evaluation still require whatever external services are
configured in `.env`.

## Google Workspace Sync

The sync needs a Google service-account JSON key with domain-wide delegation.
In Docker, place the key on the host under `./secrets/`; `compose.yaml` mounts
that directory read-only at `/app/secrets`.

Recommended `.env` value:

```bash
GOOGLE_SA_KEY_PATH=/app/secrets/google-service-account.json
```

Required settings:

```bash
GOOGLE_DELEGATED_SUBJECT=admin@yourschool.it
GOOGLE_DOMAIN=yourschool.it
GOOGLE_TEACHER_GROUP=docenti@yourschool.it
GOOGLE_STUDENT_OU_PATHS=/Studenti,/Studenti/Triennio
GOOGLE_CLASS_GROUP_PREFIX=
```

Manual sync check:

```bash
docker compose exec app python -m auth.google_sync
```

If configuration is incomplete, the Super-admin Sync page now records a Sync
run with `status: error` and shows the missing setting instead of returning a
generic HTTP 500.

Super-admin sync provisions Teacher and Student accounts. Class membership
should come from Google Classroom when the school does not maintain class
Google Groups:

1. The Teacher opens **Classi**.
2. The Teacher clicks **Carica corsi**.
3. The Teacher selects one or more Classroom courses.
4. The Teacher clicks **Sincronizza selezionati**.

The app imports each Classroom course as a local Class and refreshes its Student
roster from Classroom.

## Google OAuth Teacher Login

Teacher password login remains the offline fallback. Google OAuth login is
optional and requires a Google Cloud **Web application** OAuth client.

Set these values in `.env`:

```bash
GOOGLE_OAUTH_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_HOSTED_DOMAIN=yourschool.it
VITE_GOOGLE_OAUTH_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
```

The frontend receives a Google Identity Services ID token and sends it to
`POST /api/auth/teacher-google-login`. The backend verifies the token audience
against `GOOGLE_OAUTH_CLIENT_ID`, checks the hosted domain when configured, and
logs in only active Teachers already present in the local database.
