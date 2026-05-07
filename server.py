"""
QuizParty — intranet-quiz-platform
Multi-teacher / multi-class edition.
"""

import os
import socket
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, send_from_directory, abort
from waitress import serve

# ── environment ──────────────────────────────────────────────────────────────

env_file = Path(__file__).parent / '.env'
print("=" * 60)
print("ENVIRONMENT CONFIGURATION CHECK")
print("=" * 60)
if env_file.exists():
    load_dotenv(env_file)
    print(f"✓ .env loaded from {env_file}")
else:
    print(f"✗ WARNING: .env file not found at {env_file}")

# Fail fast on missing required secrets
for required in ('DATABASE_URL', 'JWT_SECRET'):
    if not os.environ.get(required):
        print(f"✗ ERROR: {required} is not set — the application will not start.")
print("=" * 60)

# ── database pool ─────────────────────────────────────────────────────────────

import db

db.init_pool(
    dsn=os.environ.get('DATABASE_URL', 'postgresql:///quizparty'),
    min_size=2,
    max_size=8,
)
print("✓ Database pool initialized")

# ── Flask app ─────────────────────────────────────────────────────────────────

APP_DIR = Path(__file__).parent
STATIC_FOLDER = APP_DIR / 'frontend' / 'dist'
ASSETS_FOLDER = STATIC_FOLDER / 'assets'
IMAGES_FOLDER = APP_DIR / 'images'

APP = Flask(__name__)

# ── blueprints ────────────────────────────────────────────────────────────────

from routes.auth import auth_bp
from routes.quiz import quiz_bp
from routes.teacher import teacher_bp
from routes.super_admin import super_admin_bp

APP.register_blueprint(auth_bp)
APP.register_blueprint(quiz_bp)
APP.register_blueprint(teacher_bp)
APP.register_blueprint(super_admin_bp)

# ── static / image serving ────────────────────────────────────────────────────

@APP.route('/assets/<path:filename>')
def serve_assets(filename):
    if not ASSETS_FOLDER.exists():
        abort(404, description="Assets directory not found.")
    return send_from_directory(ASSETS_FOLDER, filename)


@APP.route('/images/<path:filename>')
def serve_images(filename):
    if not IMAGES_FOLDER.exists():
        abort(404, description="Images directory not found.")
    return send_from_directory(IMAGES_FOLDER, filename)


# Catch-all: serve React SPA for unknown paths
@APP.route('/', defaults={'path': ''})
@APP.route('/<path:path>')
def serve_react_app(path):
    index_path = STATIC_FOLDER / 'index.html'
    if not index_path.exists():
        return "React app not built. Run 'pnpm build' in /frontend.", 500
    potential_file = STATIC_FOLDER / path
    if path and potential_file.exists() and potential_file.is_file():
        return send_from_directory(STATIC_FOLDER, path)
    return send_from_directory(STATIC_FOLDER, 'index.html')


# ── startup ───────────────────────────────────────────────────────────────────

def _local_ips() -> list[str]:
    addrs = ['127.0.0.1']
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        if ip not in addrs:
            addrs.append(ip)
        s.close()
    except Exception:
        pass
    return addrs


def run_server() -> None:
    port = 5001
    print("=" * 60)
    print("Starting QuizParty (multi-tenant edition)")
    print(f"Static: {STATIC_FOLDER}")
    print(f"Images: {IMAGES_FOLDER}")
    print("Threads: 8")
    for addr in _local_ips():
        tag = "(local)" if addr == '127.0.0.1' else "(LAN)"
        print(f"  http://{addr}:{port}  {tag}")
    print("=" * 60)
    serve(
        APP,
        host='0.0.0.0',
        port=port,
        threads=8,
        channel_timeout=60,
        cleanup_interval=30,
    )


if __name__ == '__main__':
    run_server()
