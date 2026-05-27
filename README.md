# intranet-quiz-platform

Multi-teacher, multi-class quiz platform for school intranets.  
Forked from `intranet-quiz-manager` v2.6.0. Targets central-server deployment for an entire secondary school (~150 teachers, ~800 students). Fully offline at quiz time.

---

## Getting started

The recommended setup is **Docker Compose**. It handles PostgreSQL, the Python backend, and the built frontend in a single command — no manual dependency installation required.

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Mac/Windows) or Docker Engine + Compose plugin (Linux)
- `openssl` for generating the JWT secret (included on macOS/Linux; available via Git for Windows)

### 1. Clone the repo

```bash
git clone <repo-url> intranet-quiz-platform
cd intranet-quiz-platform
```

### 2. Configure the environment

```bash
cp .env.example .env
```

Open `.env` and fill in these three required values:

```bash
# Strong password for the PostgreSQL quizparty user
POSTGRES_PASSWORD=choose_a_strong_password

# Secret key for signing JWTs — generate with:
#   openssl rand -hex 64
JWT_SECRET=paste_the_output_here

# Email of the first super-admin account you'll create in step 4
ADMIN_DEFAULT_EMAIL=admin@yourschool.it
```

Everything else in `.env` is optional (email, LLM grading, Google Workspace sync).

### 3. Start the stack

```bash
docker compose up -d
```

This builds the image (first run takes ~2 min), starts PostgreSQL, waits for it to be healthy, applies the database schema, and starts the app on the host port configured by `APP_PORT` (`5002` in the school deployment; container-internal Flask still listens on `5001`).

#### Proxmox LXC / debug build note

On the school server Docker runs inside a Proxmox LXC container. The default Docker BuildKit builder can fail during Dockerfile `RUN` steps with AppArmor errors such as:

```text
unable to apply apparmor profile
apparmor_parser: Access denied
```

Use the preconfigured remote BuildKit builder before building the debug stack:

```bash
docker buildx use lxc-remote2
docker compose -f compose.yaml -f compose-debug.yaml up --build
```

`lxc-remote2` points at a BuildKit daemon started with AppArmor disabled for build containers, avoiding the LXC/AppArmor limitation. The `security_opt: apparmor:unconfined` entries in Compose help runtime containers, but they do not apply to Dockerfile build steps.

#### Production vs development Compose modes

- `compose.yaml` is the normal/production stack: `db`, `app`, and `worker`. The React frontend is built during the Docker image build and copied into `frontend/dist`; Flask serves that static build from the `app` container.
- `compose-debug.yaml` is a development override. It adds the separate `frontend` container, which runs Vite on port `5173` with hot reload and bind-mounted source files.
- Therefore the `frontend` container is only used with `docker compose -f compose.yaml -f compose-debug.yaml ...`; it is not part of the normal production stack.

Check that everything is running:

```bash
docker compose ps
docker compose logs app --tail=20
```

### 4. Create the first super-admin account

```bash
docker compose exec app python -m db.bootstrap_admin
```

You will be prompted for an email and password. Use the email you set as `ADMIN_DEFAULT_EMAIL`. A `super_admin` account is created and the first login will force a password change.

### 5. Log in

Open the configured app URL, for example **http://localhost:5002/teacher/login** in the school deployment, enter your credentials, and change your password when prompted.

---

## Updating the app

```bash
git pull
docker compose up -d --build
```

The entrypoint runs `db.migrate up` automatically on every start, so new migrations are applied without manual steps.

---

## Migrating from v2.6.0 (single-tenant)

If you have existing data from `intranet-quiz-manager` v2.6.0, run the migration script **after** the stack is up:

```bash
docker compose exec app python scripts/migrate_v260_to_platform.py \
  --source /path/to/intranet-quiz-manager \
  --owner-email mauro@school.it \
  --owner-name "Mauro Longano"
```

> The source path must be accessible inside the container. Mount it as a volume in `compose.yaml` or copy the data into the container first, or run the script directly on the host with bare-metal setup.

The script:
- Creates the teacher as `super_admin` with a printed temp password
- Migrates students, classes, question bank snapshots, scores, archives
- Does **not** migrate in-flight quiz plans (stop the old server before running)
- Is forward-only; the source directory is never modified

Pass `--discard-in-flight` to proceed even if `quizzes/` is non-empty.

---

## Production: putting it behind Nginx

In production the Docker stack runs on the host port configured by `APP_PORT` and Nginx sits in front for TLS and to serve quiz images directly. In the school deployment this platform uses `APP_PORT=5002` because port `5001` is reserved for the legacy single-tenant service.

### Generate a self-signed certificate

```bash
mkdir -p tls
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout tls/privkey.pem \
  -out tls/fullchain.pem \
  -subj "/CN=quiz.school.local"
```

Distribute `tls/fullchain.pem` to staff and student devices via your school's MDM so browsers trust it without warnings.

### Nginx site config

```nginx
server {
    listen 443 ssl http2;
    server_name quiz.school.local;

    ssl_certificate     /opt/quizparty/tls/fullchain.pem;
    ssl_certificate_key /opt/quizparty/tls/privkey.pem;

    client_max_body_size 25m;

    # Serve quiz images directly — bypasses the app entirely
    location /images/ {
        alias /var/lib/docker/volumes/intranet-quiz-platform_app_images/_data/;
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name quiz.school.local;
    return 301 https://$host$request_uri;
}
```

### Start Docker on boot

```bash
# Docker Compose already uses restart: unless-stopped
# Just ensure the Docker daemon itself starts on boot:
sudo systemctl enable docker
```

### Backups

The `app_backups` Docker volume stores `pg_dump` archives and image tarballs. Add a cron job on the host:

```bash
# /etc/cron.d/quizparty-backup
0 2 * * * root docker compose -f /opt/quizparty/compose.yaml exec -T app \
  sh -c 'pg_dump --format=custom $DATABASE_URL > backups/db/quizparty-$(date +\%F).dump && \
         tar czf backups/images/images-$(date +\%F).tar.gz images/ && \
         find backups/ \( -name "*.dump" -o -name "*.tar.gz" \) | sort | head -n -30 | xargs rm -f'
```

---

## Email sending (optional)

QuizParty can email quiz results to students. Fill in the Email section of `.env`:

```bash
EMAIL_SENDER=noreply@yourschool.it
EMAIL_PASSWORD=your_app_password
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
```

Emails are sent **from the logged-in teacher** (via the `From:` header), so each student sees the email coming from their own teacher. The `EMAIL_SENDER` account is used only for SMTP authentication.

### Gmail / Google Workspace: domain-wide delegation

Gmail SMTP does not allow sending as another user by default. To let teachers send emails that appear to come from themselves, the authenticated SMTP account (`EMAIL_SENDER`) needs **domain-wide "Send mail as" delegation**:

1. Create a dedicated account on your Google Workspace, e.g. `noreply@yourschool.it`
2. Set `EMAIL_SENDER=noreply@yourschool.it` in `.env`
3. In the [Google Admin Console](https://admin.google.com):
   - Go to **Apps → Google Workspace → Gmail → User settings**
   - Enable **"Allow per-user outbound gateways"** at the domain level
   - Or add each teacher as a **"Send mail as"** alias on the `noreply` account via [Gmail settings](https://mail.google.com/mail/u/0/#settings/accounts)
4. Generate an [App Password](https://myaccount.google.com/apppasswords) for the `noreply` account and put it in `EMAIL_PASSWORD`

After setup, each teacher's outgoing emails carry their own name and address in the `From:` field, and replies go directly to the teacher.

---

## Google Workspace sync (optional)

Put the service-account JSON key where Docker can mount it:

```bash
mkdir -p secrets
cp /path/to/google-service-account.json secrets/google-service-account.json
```

Fill in the Google section of `.env` (domain, delegated admin, teacher group,
student OU paths — see `.env.example` for details). In Docker, the key path
should usually be:

```bash
GOOGLE_SA_KEY_PATH=/app/secrets/google-service-account.json
```

Then trigger sync from **Super-Admin → Sync** in the UI, or via:

```bash
docker compose exec app python -m auth.google_sync
```

Super-admin sync provisions accounts. Teachers then open **Classi** and use
**Google Classroom → Carica corsi → Sincronizza selezionati** to import class
rosters from their Classroom courses.

Sync requires internet. Quiz sessions work fully offline once account and roster
sync have run.

### Google login for teachers

Password login remains available and works offline. To add **Accedi con Google**
for Teachers, create a **Web application** OAuth client in Google Cloud Console
and set both backend and frontend client IDs:

```bash
GOOGLE_OAUTH_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_HOSTED_DOMAIN=yourschool.it
VITE_GOOGLE_OAUTH_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
```

Google login only works for Teachers already provisioned in QuizParty. It does
not create accounts automatically.

---

## Alternative: bare-metal setup

Use this only if you cannot run Docker (e.g. the school server has restrictions).

**Prerequisites:** Python ≥ 3.10 with `uv`, Node.js ≥ 18 with `pnpm`, PostgreSQL ≥ 15, `libmagic`.

```bash
# Dependencies
uv sync
cd frontend && pnpm install && pnpm build && cd ..

# Database
sudo -u postgres createuser quizparty
sudo -u postgres createdb -O quizparty quizparty

# Environment — set DATABASE_URL explicitly:
# DATABASE_URL=postgresql://quizparty:<password>@localhost:5432/quizparty
cp .env.example .env  # then edit

# Schema + first account
python -m db.migrate up
python -m db.bootstrap_admin

# Start
uv run server.py
# or production:
waitress-serve --listen=127.0.0.1:5001 --threads=8 server:app
```

---

## Development

```bash
# Backend with hot reload
uv run server.py

# Frontend dev server (hot reload, proxied to backend)
cd frontend && pnpm dev
# → http://localhost:5173

# Type check
cd frontend && pnpm build

# Tests in Docker — safe runner creates/uses quizparty_test
scripts/run_tests_safe.sh tests/

# Host-only tests — DATABASE_URL must point to a DB whose name contains "test"
sudo -u postgres createdb -O quizparty quizparty_test
DATABASE_URL=postgresql:///quizparty_test pytest tests/
```

### Test database safety

Do **not** run `pytest` directly inside the `app` container. The app container's normal `DATABASE_URL` points at the real application database, while the pytest fixtures truncate application tables to isolate tests.

Use:

```bash
scripts/run_tests_safe.sh tests/
```

The test configuration has a hard guard: `tests/conftest.py` refuses to run unless the effective database name contains `test`.

---

## Architecture

| Layer | Technology |
|-------|-----------|
| Web framework | Flask + Waitress (8 threads) |
| Database | PostgreSQL 15+ · psycopg 3 · connection pool |
| Auth | HS256 JWT — teacher 12 h · student session-scoped |
| Frontend | React 19 · TypeScript · Vite · TanStack Query |
| Styling | Tailwind CSS v4 (Neon Noir design system) |
| Images | `images/{teacher_id}/{snapshot_id}/` · served by Nginx |
| Backups | `pg_dump` + `tar` · 30-day retention |
| Google sync | Admin SDK Directory API · service account · online-only |

14-table schema: `teachers`, `students`, `classes`, `class_teachers`, `class_students`, `question_snapshots`, `quiz_sessions`, `session_classes`, `quiz_plans`, `score_entries`, `score_archives`, `student_list_snapshots`, `sync_runs`, `schema_migrations`.

See `docs/REFACTOR-PLAN-PROMPT.md` for full architecture decisions and `docs/DESIGN.md` for the Neon Noir design system.

---

## License

MIT
