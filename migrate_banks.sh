#!/bin/bash

# Migration script for QuizParty banks
# This script moves existing bank directories to the new banks/ structure

echo "QuizParty Banks Migration Script"
echo "================================"
echo ""

# Check if we're in the right directory
if [ ! -f "server.py" ]; then
    echo "❌ Error: This script must be run from the QuizParty root directory"
    echo "   (the directory containing server.py)"
    exit 1
fi

# Create banks directory if it doesn't exist
if [ ! -d "banks" ]; then
    echo "Creating banks/ directory..."
    mkdir -p banks
fi

# Function to migrate a directory
migrate_dir() {
    local dir_name=$1
    local source_dir=$dir_name
    local dest_dir="banks/$dir_name"

    if [ -d "$source_dir" ] && [ "$source_dir" != "$dest_dir" ]; then
        echo ""
        echo "Found: $source_dir/"

        # Check if destination already exists
        if [ -d "$dest_dir" ]; then
            echo "⚠️  Warning: $dest_dir already exists!"
            echo "   Files will be merged. Continue? (y/n)"
            read -r response
            if [ "$response" != "y" ]; then
                echo "   Skipping $dir_name"
                return
            fi
        fi

        echo "   Moving to $dest_dir..."

        # Create destination if it doesn't exist
        mkdir -p "$dest_dir"

        # Move all files
        if [ "$(ls -A $source_dir)" ]; then
            mv "$source_dir"/* "$dest_dir/" 2>/dev/null
            if [ $? -eq 0 ]; then
                echo "   ✅ Moved successfully"
                # Remove old directory if empty
                rmdir "$source_dir" 2>/dev/null
                if [ $? -eq 0 ]; then
                    echo "   Removed empty $source_dir directory"
                fi
            else
                echo "   ⚠️  Some files may not have been moved (check manually)"
            fi
        else
            echo "   Directory is empty, removing..."
            rmdir "$source_dir"
        fi
    else
        echo "✓ $dir_name: Already migrated or not found"
    fi
}

echo "Checking for directories to migrate..."
echo ""

# Migrate each bank directory
migrate_dir "question_bank"
migrate_dir "scores_bank"
migrate_dir "students_bank"

echo ""
echo "================================"
echo "Migration complete!"
echo ""
echo "Next steps:"
echo "1. Restart the QuizParty server"
echo "2. Verify your banks are accessible from the admin dashboard"
echo "3. (Optional) Set up cloud sync in your .env file"
echo ""
