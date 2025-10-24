# app.py
from flask import Flask, send_from_directory, abort
import os
import socket
from waitress import serve


# Import Blueprints
from routes.quiz import quiz_bp
from routes.admin import admin_bp

from utils import IMAGES_FOLDER # <-- Import image folder constant
# Define the static folder relative to app.py location
# Assumes 'frontend/dist' exists at the same level as app.py
APP_DIR = os.path.dirname(__file__)
STATIC_FOLDER = os.path.join(APP_DIR, 'frontend', 'dist')
ASSETS_FOLDER = os.path.join(STATIC_FOLDER, 'assets')
# Define image folder path relative to app.py
IMAGE_DIR = os.path.join(APP_DIR, IMAGES_FOLDER) # <-- Define image directory path

# Initialize Flask App
APP = Flask(__name__)

# Register Blueprints
APP.register_blueprint(quiz_bp)  # For /api/start, /api/submit, /api/resume
APP.register_blueprint(admin_bp) # For /api/scores, /api/review

# --- Static File Serving ---

# Route to serve static assets (JS, CSS, images) from 'assets' subfolder
@APP.route('/assets/<path:filename>')
def serve_assets(filename):
    if not os.path.exists(ASSETS_FOLDER):
         abort(404, description="Assets directory not found.")
    return send_from_directory(ASSETS_FOLDER, filename)

# --- NEW: Route to serve images from the images folder ---
@APP.route(f'/{IMAGES_FOLDER}/<path:filename>')
def serve_images(filename):
    if not os.path.exists(IMAGE_DIR):
         abort(404, description="Images directory not found.")
    # Basic security: prevent path traversal (Flask's send_from_directory helps)
    # Could add more checks here if needed (e.g., allowed extensions)
    return send_from_directory(IMAGE_DIR, filename)

# Route to serve frontend application (index.html) and handle client-side routing
# This catch-all route should come AFTER specific API and asset routes.
@APP.route('/', defaults={'path': ''})
@APP.route('/<path:path>')
def serve_react_app(path):
    index_path = os.path.join(STATIC_FOLDER, 'index.html')
    if not os.path.exists(index_path):
        return "React app not built or index.html missing! Run 'npm run build' in /frontend.", 500

    # Check if the requested path corresponds to a static file in the root of STATIC_FOLDER
    potential_file = os.path.join(STATIC_FOLDER, path)
    if path != "" and os.path.exists(potential_file) and os.path.isfile(potential_file):
        print(f"Serving static file: {path}")
        return send_from_directory(STATIC_FOLDER, path)
    else:
        # Otherwise, serve the main index.html for React Router to handle routing
        print(f"Serving index.html for path: {path}")
        return send_from_directory(STATIC_FOLDER, 'index.html')

# --- Main Execution ---
#
def get_local_ip_addresses():
    """Get all local IP addresses for the machine."""
    addresses = []
    try:
        # Get hostname
        hostname = socket.gethostname()
        # Get all addresses associated with the hostname
        for info in socket.getaddrinfo(hostname, None):
            addr = info[4][0]
            # Filter out IPv6 link-local and loopback
            if ':' not in addr and addr not in addresses and not addr.startswith('127.'):
                addresses.append(addr)
    except Exception:
        pass

    # Always include localhost
    if '127.0.0.1' not in addresses:
        addresses.insert(0, '127.0.0.1')

    return addresses

def run_server():
    port = 5001
    print("=" * 60)
    print("Starting Quiz Application Server (Production Mode)")
    print("=" * 60)
    print("Serving application...")
    print(f"React app static folder: {STATIC_FOLDER}")
    print(f"Assets folder: {ASSETS_FOLDER}")
    print(f"Images folder: {IMAGE_DIR}")
    print("API endpoints registered under /api")
    print("-" * 60)
    print("Server configuration:")
    print("  - WSGI Server: Waitress (production-ready)")
    print("  - Host: 0.0.0.0 (accessible on LAN)")
    print(f"  - Port: {port}")
    print("  - Threads: 6 (handles 6 concurrent requests)")
    print("  - File locking: Enabled (prevents race conditions)")
    print("  - Question caching: Enabled (reduces disk I/O)")
    print("=" * 60)
    print("Server is running and ready to accept connections!")
    print("\nAccess the application at:")

    # Get and display all available addresses
    addresses = get_local_ip_addresses()
    for addr in addresses:
        if addr == '127.0.0.1':
            print(f"  • http://localhost:{port}  (local access)")
        else:
            print(f"  • http://{addr}:{port}  (LAN access)")

    print("=" * 60)

    # Use Waitress production server with threading
    serve(
        APP,
        host='0.0.0.0',
        port=port,
        threads=6,  # Handle up to 6 concurrent requests
        channel_timeout=60,  # Timeout for idle connections
        cleanup_interval=30,  # Clean up old connections every 30s
        recv_bytes=65536,  # Receive buffer size
        send_bytes=65536,  # Send buffer size
    )


if __name__ == '__main__':
    run_server()
