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
scripts/run_tests_safe.sh tests/ -v
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

LLM calls are guarded by a per-answer timeout and an output budget. Tune them with:

```env
LLM_TIMEOUT_SECONDS=120   # background worker: a long wait costs students nothing
LLM_RETRIES=0
LLM_BACKOFF_FACTOR=0.5
LLM_MAX_TOKENS=4096       # reasoning models think before the verdict
```

Both are pinned on the job when it is enqueued. A reasoning model (the
school's Qwen3) spends part of `LLM_MAX_TOKENS` thinking; if it runs out the
reply arrives empty and the answer stays pending with "Risposta troncata…".
Raise `LLM_MAX_TOKENS`, and `LLM_TIMEOUT_SECONDS` with it: generating 1024
tokens took about 12 s on the school server.

## LLM Grading Worker

Open-question grading is asynchronous: submissions mark open answers as
`pending`, and the `worker` compose service (`python -m services.llm_jobs
worker`) claims jobs from the `llm_grading_jobs` table and grades one answer at
a time. If the worker is down or the provider fails, submissions still succeed
— scores simply stay provisional until grading completes.

**Run exactly one worker replica.** On startup the worker calls
`requeue_running_jobs()`, which resets *every* job in `running` back to
`pending`. With a second replica already grading, that reclaims its job and
both would process the same answers. Scaling grading means adding a claim
lease first, not `--scale worker=N`.

A worker started with `USE_LLM_EVAL` unset logs a warning and keeps running:
open answers simply stay `pending`, which is safe — a failed or unconfigured
evaluation is never recorded as a grade. With `USE_LLM_EVAL=1` but no enabled
default endpoint, the app and worker also start and log a warning: the
allowlist is edited at runtime, and making grading unavailable must never take
quizzes offline at the next restart. Keys are not checked at startup at all —
they belong to teachers (see *Grading access* below).

Check the worker:

```bash
docker compose logs worker --tail=100
docker compose ps worker
```

Find failed or stuck jobs:

```bash
docker compose exec db psql -U quizparty -d quizparty -c \
  "SELECT id, session_id, job_type, status, processed_items, total_items,
          error, created_at
   FROM llm_grading_jobs
   WHERE status IN ('failed', 'running')
   ORDER BY created_at DESC LIMIT 20;"
```

Find score entries with answers still pending:

```bash
docker compose exec db psql -U quizparty -d quizparty -c \
  "SELECT se.session_id, COUNT(*)
   FROM score_entries se, jsonb_array_elements(se.answers) a
   WHERE a->>'llm_status' = 'pending'
   GROUP BY se.session_id;"
```

Recovery:

1. Fix the underlying cause (worker container down, the teacher's key missing
   or rejected, endpoint unreachable or out of quota, `LLM_TIMEOUT_SECONDS` too
   low). The answer's `llm_error` says which.
2. Restart the worker if needed: `docker compose restart worker`.
3. Ask the Teacher to click **Rivaluta risposte aperte** on the session's
   scores page (or `POST /api/teacher/sessions/<id>/scores/regrade-open`).
   This enqueues a new `regrade_session` job that re-processes answers that
   are still `pending`.

Note: regrades are rate-limited per session (`LLM_REGRADE_COOLDOWN_SECONDS`,
default 60s) — a second click within the cooldown returns HTTP 429. Failed
jobs are never retried automatically; a manual regrade is always required.
All grading changes are recorded in `score_history` and can be reverted from
the session's **Cronologia modifiche** panel.

A job whose individual answers failed still finishes as `completed`: the
outcome lives on the answers themselves. Its `error` column summarises which
questions were not evaluated, including answers skipped because a teacher
edited them while the evaluation was in flight.

## Grading worker throughput

Each open answer is one provider call. A class of 30 with six open questions is
about 180 calls, so grading them one after another took 15–75 minutes before a
score stopped being provisional. The worker now grades on a bounded thread pool.

```bash
LLM_WORKER_CONCURRENCY=6            # simultaneous provider calls
LLM_WORKER_MAX_JOBS=3               # jobs in flight at once
LLM_WORKER_MAX_JOBS_PER_TEACHER=2   # 0 disables
```

Two bounds because the work arrives in two shapes: a regrade is **one** job with
many score entries, while a class handing in is **many** jobs with one entry
each. Only raising the first would leave thirty submissions still graded one
after the other.

`LLM_WORKER_MAX_JOBS_PER_TEACHER` matters now that teachers hold their own API
keys: it stops one teacher's concurrent jobs hammering their own quota into rate
limits. A 429 is still retried as a temporary error, but the cap avoids getting
there.

### Raising it

The connection pool is sized as `concurrency + max_jobs + 2` and logged at
startup. That relationship is not cosmetic: a pool smaller than the concurrency
**deadlocks** rather than queueing, and surfaces as jobs mysteriously marked
`failed` with "couldn't get a connection after 30.00 sec". Postgres allows 100
connections by default and the app itself uses 8, so there is room to raise the
concurrency well beyond the default — the real ceiling is the provider's rate
limit, not this database.

Watch a bulk regrade with:

```bash
docker compose logs -f worker
```

Job ids are interleaved in the log lines (`[LLM_JOBS job=42]`), which is how to
tell concurrency is actually happening.

## Grading access: endpoints and teacher keys

Who controls what:

| | Controls |
|---|---|
| Super-admin | **where** grading may go: the endpoint allowlist (Super Admin → Endpoint LLM) — address, protocol, the models each may be asked for, enabled, default. Never keys. |
| Teacher | their **own key** for an endpoint (Impostazioni → Valutazione), and optionally which allowed endpoint and model they use |
| `.env` | only the master switch (`USE_LLM_EVAL`), tuning, and the encryption master key — no destination, model or key |

A grading call uses the teacher's selected endpoint while it is enabled,
otherwise the default; the teacher's model if that endpoint lists it, otherwise
the endpoint's **first** model; and the teacher's key **for that endpoint**. Keys
are stored per `(teacher, endpoint)` and never sent anywhere else, so a key
issued for the school server cannot reach another host even after the default
changes. There is no shared key to fall back on — deliberately: a fallback key
would be sent on everyone's behalf, unattributable.

A teacher without a key is a normal state. Their submissions are accepted as
always; open answers stay `pending` with an `llm_error` saying the key is
missing, and the scores page links them to the settings. Once they set a key,
**Rivaluta risposte aperte** grades what was left.

With a LiteLLM gateway, issue each teacher their own virtual key: LiteLLM then
tracks usage and spend per teacher and can enforce a budget per key.

### Who has a key

```sql
SELECT t.email, e.slug AS endpoint, c.fingerprint, c.updated_at
FROM teacher_llm_credentials c
JOIN teachers t ON t.id = c.teacher_id
JOIN llm_endpoints e ON e.id = c.endpoint_id
ORDER BY e.slug, t.email;
```

Deleting an endpoint deletes the keys stored for it; disabling one keeps them,
so re-enabling restores grading without anyone re-entering a key.

### The encryption master key

Keys are encrypted with `CREDENTIAL_ENCRYPTION_KEY` before being written, and
that key is **not** in the database — a `pg_dump` therefore contains no usable
credentials. It is required for automatic grading: without it no teacher can
store a key, and the settings page says so.

```bash
docker compose exec app python scripts/rotate_credential_key.py --generate
# put the printed value in .env as CREDENTIAL_ENCRYPTION_KEY, then:
docker compose up -d --force-recreate app worker
```

### Rotating the master key

Re-encrypt **before** replacing the value. Replacing it first makes every stored
key unreadable and each teacher has to enter theirs again.

```bash
# 1. new key
docker compose exec app python scripts/rotate_credential_key.py --generate

# 2. check every stored key decrypts, without writing anything
docker compose exec app python scripts/rotate_credential_key.py \
    --new-key '<new>' --dry-run

# 3. re-encrypt (single transaction: all or nothing)
docker compose exec app python scripts/rotate_credential_key.py --new-key '<new>'

# 4. update CREDENTIAL_ENCRYPTION_KEY in .env, then
docker compose up -d --force-recreate app worker
```

If step 3 fails nothing is written, so it is safe to retry.

### If the master key was replaced without re-encrypting

Nothing crashes: an undecryptable key counts as absent, so those teachers' open
answers stay `pending` until it is fixed. Restore the old value of
`CREDENTIAL_ENCRYPTION_KEY` and run the rotation properly, or ask the affected
teachers to re-enter their key. `key_version` is the fingerprint of the master
key that encrypted each row; rows whose `key_version` differs from the current
key are the ones to fix:

```sql
SELECT t.email, e.slug AS endpoint, c.key_version, c.updated_at
FROM teacher_llm_credentials c
JOIN teachers t ON t.id = c.teacher_id
JOIN llm_endpoints e ON e.id = c.endpoint_id;
```

## LAN-only endpoints and DNS

The host resolves through public DNS, which cannot see names that exist only in
the school's DNS (the LiteLLM gateway, for instance). The `app` and `worker`
containers therefore use `CONTAINER_DNS` from `.env` — set it to the school's DNS
server — with 8.8.8.8 as a second resolver so hosted providers keep working if
it is down. Docker's embedded DNS still answers for service names (`db`).

Check what the worker sees:

```bash
docker compose exec -T worker python -c \
  "import socket; print(socket.gethostbyname('<gateway hostname>'))"
```

Changing `CONTAINER_DNS` needs `docker compose up -d app worker` (a `restart`
does not re-read compose configuration). Fixing the host's own resolver instead
belongs in the Proxmox container config (`pct set <id> --nameserver ...`):
editing `/etc/resolv.conf` inside the LXC does not survive a reboot.

## Rotating the database password

`POSTGRES_PASSWORD` is read by the Postgres image **only when the data volume is
first created**. Editing `.env` afterwards changes what the app *sends*, not what
the server *accepts* — so a naive rotation locks the app out of its own database
while leaving the old password valid. Change both, in this order:

```bash
# 1. pick a new value and set it in .env (POSTGRES_PASSWORD=...).
#    Use hex, not base64: compose builds DATABASE_URL by interpolating this
#    value into a URL, and base64 can emit '/' or '+', which corrupts the DSN.
openssl rand -hex 32

# 2. change it in the server, reading the new value from .env so it is never
#    typed into a shell history
docker compose exec -T db psql -U quizparty -d quizparty -c \
  "ALTER USER quizparty PASSWORD '$(grep -m1 '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)';"

# 3. recreate the app and worker so they pick up the new .env.
#    `restart` does NOT re-read env_file — it must be `up -d`.
docker compose up -d --force-recreate app worker
```

Verify the old password is dead (this must print `rejected`) — run it from the
`app` container, not from `db`: `pg_hba.conf` has `host all all 127.0.0.1 trust`,
so *any* password is accepted on the database container's own loopback and a test
run there proves nothing.

```bash
docker compose exec -T -e PGPASSWORD='<old>' app python -c "
import psycopg, os
try:
    psycopg.connect('postgresql://quizparty@db:5432/quizparty',
                    password=os.environ['PGPASSWORD'], connect_timeout=5).close()
    print('ACCEPTED — rotation did not take')
except Exception:
    print('rejected')"
```

Postgres publishes no host port (only `app` does), so the database is reachable
only from inside the compose network. That limits the blast radius of a leaked
password to someone who already has host or container access — it does not make
rotation optional.

## Secrets never belong in the repository

`.env` and `secrets/` are gitignored; `.env.example` is a **template** and must
contain only placeholders. The same applies to documentation: a working command
pasted into `AGENTS.md`, `README.md` or a runbook is as public as the code. Write
commands so they read the value at run time instead:

```bash
-e DATABASE_URL="postgresql://quizparty:$(grep -m1 '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)@db:5432/quizparty_test"
```

To check the tree before pushing:

```bash
git ls-files -z | xargs -0 grep -nEI '(PASSWORD|SECRET|API_KEY|TOKEN|ENCRYPTION_KEY)[[:space:]]*[=:][[:space:]]*[^[:space:]#]{8,}'
```

Anything that reaches a public remote must be treated as compromised and
rotated. Deleting the line, or rewriting history, does not undo the disclosure:
GitHub keeps unreachable objects reachable by SHA, forks and clones keep their
own copies, and mirrors may have indexed it. Rotation is the remediation;
scrubbing history is cleanup afterwards.

## Image paths

Images are stored at `images/{teacher_id}/{snapshot_id}/{file}` and
`serve_images()` resolves that form only.

Historical note: rows written before the multi-tenant migration referenced
`images/{snapshot_id}/{file}`, and the route used to resolve those by scanning
every teacher's directory — which meant one teacher's image could be served out
of another's folder. Those rows have been rewritten to the full form and the
cross-tenant fallback is gone. A path missing its `teacher_id` segment is now a
404, not a scan, so **never reintroduce a fallback that searches other teachers'
directories** — that is a multi-tenant isolation hole, not a convenience.

## Teacher Login Rate Limit

`POST /api/auth/teacher-login` locks an account key after repeated failed
password attempts (sliding window, in-process). Defaults: 10 failures per 15
minutes per email. Tune with:

```env
LOGIN_RATE_MAX_FAILURES=10
LOGIN_RATE_WINDOW_SECONDS=900
```

The counter clears on successful login and on app restart. A locked-out user
sees HTTP 429 (`TOO_MANY_ATTEMPTS`); they can wait out the window, use Google
login, or an operator can restart the `app` container to clear all counters.

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

`compose.yaml` runs the `backup` service by default. It uses `scripts/backup_loop.sh` inside a `postgres:16-alpine` container and writes to the host-visible `./backups/` directory:

```text
./backups/db/quizparty-YYYYMMDDTHHMMSSZ.dump
./backups/images/quizparty-images-YYYYMMDDTHHMMSSZ.tar.gz
./backups/manifests/quizparty-YYYYMMDDTHHMMSSZ.json
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

## Data retention

Students' data serves the assessment of one school year (the official grade is
in the school register), so it is kept through **31 December after the school
year ends** (September–August, Europe/Rome) and deleted on 1 January. The
period is the school's decision, recorded in its register of processing.

What goes, per session whose latest submission (or creation) falls in that
year: the session with its answers, scores, motivations, score history,
grading jobs and published results; the score archives copied from it (they
expire with the session, not with the day they were made); teachers' saved
student lists of that year. Then classes of an expired year that no session
uses, and students no longer at the school (`disabled`) with nothing left that
refers to them. Quiz content stays. Never touched: an active session, or one
with grading queued. Backups still hold deleted data until they are pruned
(`BACKUP_RETENTION_DAYS`).

`DATA_RETENTION` = `report` (default: compute only), `apply` (the worker
deletes, checking at most every `DATA_RETENTION_CHECK_SECONDS`, 6 h), `off`.
Each run records counts only in `retention_runs`. Check what is due:

```bash
$DC exec worker python -m services.retention          # report
$DC exec worker python -m services.retention apply    # delete now
```

The super-admin page (Conservazione dati) shows the same report; each
session's scores page tells the teacher until when its data is kept.

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
  --db-dump ./backups/db/quizparty-YYYYMMDDTHHMMSSZ.dump \
  --images-tar ./backups/images/quizparty-images-YYYYMMDDTHHMMSSZ.tar.gz \
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
