#!/bin/bash

# Fix Git remote authentication for banks repository

echo "Fixing Git remote authentication..."

cd banks || exit 1

# Remove old remote
echo "Removing old remote..."
git remote remove origin 2>/dev/null || true

# Get token from .env
cd ..
TOKEN=$(grep BANKS_GIT_TOKEN .env | cut -d '=' -f2)
REMOTE=$(grep BANKS_GIT_REMOTE .env | cut -d '=' -f2)

if [ -z "$TOKEN" ] || [ -z "$REMOTE" ]; then
    echo "Error: Could not read BANKS_GIT_TOKEN or BANKS_GIT_REMOTE from .env"
    exit 1
fi

# Add new remote with token authentication
echo "Adding remote with token authentication..."
cd banks
NEW_REMOTE=$(echo "$REMOTE" | sed "s|https://|https://${TOKEN}@|")
git remote add origin "$NEW_REMOTE"

echo "✅ Remote updated successfully!"
echo "You can now try syncing from the dashboard."
