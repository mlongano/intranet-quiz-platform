# ── Stage 1: build the React frontend ────────────────────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /build

# Install pnpm via corepack (built into Node 22)
RUN corepack enable && corepack prepare pnpm@latest --activate

# Cache dependency layer separately from source
COPY frontend/package.json frontend/pnpm-lock.yaml ./
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
    UV_SYSTEM_PYTHON=1

# Install Python dependencies (cache this layer when only source changes)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# ── Application code ──────────────────────────────────────────────────────────
COPY . .

# Overwrite with the freshly built frontend
COPY --from=frontend-builder /build/dist ./frontend/dist

# Create mount-point directories so Docker volumes attach cleanly
RUN mkdir -p images backups/db backups/images

# ── Runtime ───────────────────────────────────────────────────────────────────
EXPOSE 5001

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
