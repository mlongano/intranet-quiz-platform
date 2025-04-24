# app.py
from flask import Flask, send_from_directory, abort
import os

# Import Blueprints
from routes.quiz import quiz_bp
from routes.admin import admin_bp

# Define the static folder relative to app.py location
# Assumes 'frontend/dist' exists at the same level as app.py
STATIC_FOLDER = os.path.join(os.path.dirname(__file__), 'frontend', 'dist')
ASSETS_FOLDER = os.path.join(STATIC_FOLDER, 'assets')

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
if __name__ == '__main__':
    # Use Waitress for production
    from waitress import serve
    print("Serving application...")
    print(f"React app static folder: {STATIC_FOLDER}")
    print(f"Assets folder: {ASSETS_FOLDER}")
    print("API endpoints registered under /api")
    serve(APP, host='0.0.0.0', port=5001)
    # For development using Flask's built-in server (less recommended for prod):
    # APP.run(host='0.0.0.0', port=5001, debug=True) # Use debug=True for auto-reload
