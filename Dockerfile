# ── Stage 1: build the React frontend ────────────────────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /build

ARG VITE_GOOGLE_OAUTH_CLIENT_ID=
ENV VITE_GOOGLE_OAUTH_CLIENT_ID=$VITE_GOOGLE_OAUTH_CLIENT_ID

# Install pnpm via corepack (built into Node 22)
RUN corepack enable && corepack prepare pnpm@10 --activate

# Cache dependency layer separately from source
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/.npmrc ./
RUN pnpm install --frozen-lockfile

COPY frontend/ ./
RUN pnpm build
# Output: /build/dist


# ── Stage 2: Python application ───────────────────────────────────────────────
FROM python:3.14-slim AS app

# libmagic1  — MIME detection for image uploads
# libpq-dev  — not strictly needed for psycopg[binary], but avoids linker surprises
RUN apt-get update \
    && apt-get install -y --no-install-recommends libmagic1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── uv (fast Python package manager) ─────────────────────────────────────────
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# uv settings for container builds:
#   COMPILE_BYTECODE  → faster startup after install
#   LINK_MODE=copy    → no hardlinks across layers (required in Docker)
#   SYSTEM_PYTHON=1   → install into the system Python, skip venv creation
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_SYSTEM_PYTHON=1 \
    PATH="/app/.venv/bin:$PATH"

# Install Python dependencies (cache this layer when only source changes)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# ── Application code ──────────────────────────────────────────────────────────
COPY . .

# Overwrite with the freshly built frontend
COPY --from=frontend-builder /build/dist ./frontend/dist

# Create mount-point directories so Docker volumes attach cleanly
#
# The chmod is not cosmetic: `COPY . .` preserves the host's file modes, and the
# runtime user below is not root. A source file that happens to be mode 600 on
# the build host therefore produces an image that cannot import its own code
# ("PermissionError: '/app/services/__init__.py'"), and git records only the
# exec bit, so such a mode never shows up in a diff or review. a+rX grants read
# to everyone and execute only where it already applied or on directories, so it
# cannot make anything writable.
RUN mkdir -p images backups/db backups/images && \
    useradd -m -u 1000 appuser && \
    chmod -R a+rX /app && \
    chown -R appuser:appuser /app/images /app/backups

# ── Runtime ───────────────────────────────────────────────────────────────────
EXPOSE 5001

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER appuser

ENTRYPOINT ["docker-entrypoint.sh"]
