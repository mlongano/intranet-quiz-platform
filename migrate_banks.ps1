# QuizParty Banks Migration Script for Windows
# Run this script from PowerShell in the QuizParty root directory

Write-Host "QuizParty Banks Migration Script" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "server.py")) {
    Write-Host "❌ Error: This script must be run from the QuizParty root directory" -ForegroundColor Red
    Write-Host "   (the directory containing server.py)" -ForegroundColor Red
    exit 1
}

# Create banks directory if it doesn't exist
if (-not (Test-Path "banks")) {
    Write-Host "Creating banks/ directory..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path "banks" | Out-Null
}

# Function to migrate a directory
function Migrate-Directory {
    param(
        [string]$DirName
    )

    $SourceDir = $DirName
    $DestDir = "banks\$DirName"

    if ((Test-Path $SourceDir) -and ($SourceDir -ne $DestDir)) {
        Write-Host ""
        Write-Host "Found: $SourceDir\" -ForegroundColor Yellow

        # Check if destination already exists
        if (Test-Path $DestDir) {
            Write-Host "⚠️  Warning: $DestDir already exists!" -ForegroundColor Yellow
            Write-Host "   Files will be merged. Continue? (y/n)" -ForegroundColor Yellow
            $response = Read-Host
            if ($response -ne "y") {
                Write-Host "   Skipping $DirName" -ForegroundColor Gray
                return
            }
        }

        Write-Host "   Moving to $DestDir..." -ForegroundColor Gray

        # Create destination if it doesn't exist
        New-Item -ItemType Directory -Force -Path $DestDir | Out-Null

        # Move all files
        $files = Get-ChildItem -Path $SourceDir
        if ($files) {
            try {
                Move-Item -Path "$SourceDir\*" -Destination $DestDir -Force
                Write-Host "   ✅ Moved successfully" -ForegroundColor Green

                # Remove old directory if empty
                if (-not (Get-ChildItem -Path $SourceDir)) {
                    Remove-Item $SourceDir
                    Write-Host "   Removed empty $SourceDir directory" -ForegroundColor Gray
                }
            } catch {
                Write-Host "   ⚠️  Some files may not have been moved (check manually)" -ForegroundColor Yellow
                Write-Host "   Error: $_" -ForegroundColor Red
            }
        } else {
            Write-Host "   Directory is empty, removing..." -ForegroundColor Gray
            Remove-Item $SourceDir
        }
    } else {
        Write-Host "✓ $DirName`: Already migrated or not found" -ForegroundColor Green
    }
}

Write-Host "Checking for directories to migrate..." -ForegroundColor Cyan
Write-Host ""

# Migrate each bank directory
Migrate-Directory "question_bank"
Migrate-Directory "scores_bank"
Migrate-Directory "students_bank"

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "Migration complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Restart the QuizParty server"
Write-Host "2. Verify your banks are accessible from the admin dashboard"
Write-Host "3. (Optional) Set up cloud sync in your .env file"
Write-Host ""
