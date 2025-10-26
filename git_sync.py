# git_sync.py
"""
Git-based cloud sync utilities for banks directory.
Manages synchronization of question_bank, scores_bank, and students_bank
with a remote Git repository without interfering with the main codebase.
"""

import subprocess
import os
from pathlib import Path
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

# Configuration from environment variables
BANKS_GIT_REMOTE = os.getenv('BANKS_GIT_REMOTE', '')
BANKS_GIT_USERNAME = os.getenv('BANKS_GIT_USERNAME', '')
BANKS_GIT_TOKEN = os.getenv('BANKS_GIT_TOKEN', '')
BANKS_BASE = 'banks'


class GitSyncError(Exception):
    """Custom exception for Git sync operations"""
    pass


def is_git_configured():
    """Check if Git sync is configured"""
    configured = bool(BANKS_GIT_REMOTE and BANKS_GIT_TOKEN)
    print(f"[Git Sync] Configuration check:")
    print(f"  - BANKS_GIT_REMOTE: {'SET' if BANKS_GIT_REMOTE else 'NOT SET'} ({BANKS_GIT_REMOTE[:50] + '...' if BANKS_GIT_REMOTE and len(BANKS_GIT_REMOTE) > 50 else BANKS_GIT_REMOTE})")
    print(f"  - BANKS_GIT_TOKEN: {'SET' if BANKS_GIT_TOKEN else 'NOT SET'} ({'*' * 10 if BANKS_GIT_TOKEN else ''})")
    print(f"  - BANKS_GIT_USERNAME: {'SET' if BANKS_GIT_USERNAME else 'NOT SET'} ({BANKS_GIT_USERNAME})")
    print(f"  - Configured: {configured}")
    return configured


def is_git_initialized():
    """Check if banks directory is a Git repository"""
    git_dir = Path(BANKS_BASE) / '.git'
    initialized = git_dir.exists() and git_dir.is_dir()
    print(f"[Git Sync] Initialization check:")
    print(f"  - Banks directory: {Path(BANKS_BASE).absolute()}")
    print(f"  - .git directory exists: {initialized}")
    return initialized


def _run_git_command(args, cwd=None):
    """
    Run a git command and return the output.
    Raises GitSyncError if command fails.
    """
    if cwd is None:
        cwd = BANKS_BASE

    try:
        result = subprocess.run(
            ['git'] + args,
            cwd=cwd,
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        error_msg = e.stderr.strip() if e.stderr else str(e)
        raise GitSyncError(f"Git command failed: {error_msg}")
    except FileNotFoundError:
        raise GitSyncError("Git is not installed or not in PATH")


def init_git_repo():
    """
    Initialize Git repository in banks directory.
    Returns dict with status and message.
    """
    if not is_git_configured():
        return {
            'success': False,
            'message': 'Git sync not configured. Set BANKS_GIT_REMOTE and BANKS_GIT_TOKEN in .env'
        }

    banks_path = Path(BANKS_BASE)
    if not banks_path.exists():
        banks_path.mkdir(parents=True, exist_ok=True)

    try:
        if is_git_initialized():
            return {'success': True, 'message': 'Git repository already initialized'}

        # Initialize Git repo
        _run_git_command(['init'])

        # Configure user (required for commits)
        if BANKS_GIT_USERNAME:
            _run_git_command(['config', 'user.name', BANKS_GIT_USERNAME])
        _run_git_command(['config', 'user.email', 'quiz-sync@local'])

        # Create .gitignore for banks repo
        gitignore_path = banks_path / '.gitignore'
        if not gitignore_path.exists():
            gitignore_path.write_text('# Python cache\n__pycache__/\n*.pyc\n')

        # Add remote with authentication
        remote_url = BANKS_GIT_REMOTE
        if BANKS_GIT_TOKEN and 'https://' in remote_url:
            # Inject token into URL (GitHub uses token as username, password can be blank)
            # Format: https://TOKEN@github.com/user/repo.git
            remote_url = remote_url.replace('https://', f'https://{BANKS_GIT_TOKEN}@')

        _run_git_command(['remote', 'add', 'origin', remote_url])

        # Initial commit
        _run_git_command(['add', '.'])
        _run_git_command(['commit', '-m', 'Initial banks setup', '--allow-empty'])

        return {'success': True, 'message': 'Git repository initialized successfully'}

    except GitSyncError as e:
        return {'success': False, 'message': str(e)}
    except Exception as e:
        return {'success': False, 'message': f'Unexpected error: {str(e)}'}


def sync_banks(pull_first=True):
    """
    Sync banks directory with remote repository.

    Args:
        pull_first: If True, pull remote changes before pushing local changes

    Returns:
        dict with success status, message, and details
    """
    print(f"\n[Git Sync] Starting sync_banks (pull_first={pull_first})...")

    if not is_git_configured():
        print(f"[Git Sync] Sync aborted: Not configured")
        return {
            'success': False,
            'message': 'Git sync not configured. Set BANKS_GIT_REMOTE and BANKS_GIT_TOKEN in .env'
        }

    if not is_git_initialized():
        print(f"[Git Sync] Repository not initialized, initializing now...")
        init_result = init_git_repo()
        if not init_result['success']:
            print(f"[Git Sync] Initialization failed: {init_result['message']}")
            return init_result
        print(f"[Git Sync] Initialization successful")

    details = {
        'pulled': False,
        'committed': False,
        'pushed': False,
        'changes': []
    }

    try:
        # Check for local changes first
        print(f"[Git Sync] Checking for local changes...")
        status = _run_git_command(['status', '--porcelain'])
        print(f"[Git Sync] Status output: {status if status else '(no changes)'}")

        if status:
            # Add all changes
            print(f"[Git Sync] Adding all changes...")
            _run_git_command(['add', '.'])

            # Commit with timestamp BEFORE pulling
            timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            commit_message = f'Sync banks: {timestamp}'
            print(f"[Git Sync] Committing with message: {commit_message}")
            _run_git_command(['commit', '-m', commit_message])
            details['committed'] = True
            details['changes'] = status.split('\n')
            print(f"[Git Sync] Commit successful ({len(details['changes'])} changes)")

        # Pull remote changes after committing local changes
        if pull_first:
            try:
                print(f"[Git Sync] Pulling from remote...")
                _run_git_command(['pull', 'origin', 'main', '--rebase'])
                details['pulled'] = True
                print(f"[Git Sync] Pull successful")
            except GitSyncError as e:
                # If pull fails because branch doesn't exist yet, that's okay
                error_msg = str(e).lower()
                print(f"[Git Sync] Pull error: {e}")
                if 'couldn\'t find remote ref' not in error_msg and 'does not appear to be a git repository' not in error_msg:
                    return {'success': False, 'message': f'Pull failed: {str(e)}', 'details': details}
                print(f"[Git Sync] Pull error ignored (remote branch may not exist yet)")

        # Push to remote
        try:
            print(f"[Git Sync] Pushing to remote...")
            _run_git_command(['push', '-u', 'origin', 'main'])
            details['pushed'] = True
            print(f"[Git Sync] Push successful")
        except GitSyncError as e:
            # If no commits to push, that's okay
            error_msg = str(e).lower()
            print(f"[Git Sync] Push error: {e}")
            if 'everything up-to-date' not in error_msg and 'up to date' not in error_msg:
                return {'success': False, 'message': f'Push failed: {str(e)}', 'details': details}
            print(f"[Git Sync] Push error ignored (already up to date)")
            details['pushed'] = True  # Consider it successful if up to date

        message = 'Banks synced successfully'
        if not details['committed']:
            message = 'No changes to sync'

        print(f"[Git Sync] Sync complete: {message}")
        print(f"[Git Sync] Details: {details}\n")
        return {'success': True, 'message': message, 'details': details}

    except GitSyncError as e:
        print(f"[Git Sync] GitSyncError: {e}")
        import traceback
        traceback.print_exc()
        return {'success': False, 'message': str(e), 'details': details}
    except Exception as e:
        print(f"[Git Sync] Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return {'success': False, 'message': f'Unexpected error: {str(e)}', 'details': details}


def get_sync_status():
    """
    Get current Git sync status.

    Returns:
        dict with configuration status, repository status, and remote status
    """
    print(f"\n[Git Sync] Getting sync status...")

    status = {
        'configured': is_git_configured(),
        'initialized': is_git_initialized(),
        'remote_url': BANKS_GIT_REMOTE if is_git_configured() else None,
        'has_changes': False,
        'last_commit': None,
        'behind_remote': False
    }

    print(f"[Git Sync] Initial status: configured={status['configured']}, initialized={status['initialized']}")

    if not status['initialized']:
        print(f"[Git Sync] Repository not initialized, returning basic status")
        return status

    try:
        # Check for uncommitted changes
        print(f"[Git Sync] Checking for uncommitted changes...")
        git_status = _run_git_command(['status', '--porcelain'])
        status['has_changes'] = bool(git_status)
        print(f"[Git Sync] Has uncommitted changes: {status['has_changes']}")

        # Get last commit info
        try:
            print(f"[Git Sync] Getting last commit info...")
            last_commit = _run_git_command(['log', '-1', '--pretty=format:%h - %s (%cr)'])
            status['last_commit'] = last_commit
            print(f"[Git Sync] Last commit: {last_commit}")
        except GitSyncError:
            status['last_commit'] = 'No commits yet'
            print(f"[Git Sync] No commits yet")

        # Check if behind remote
        try:
            print(f"[Git Sync] Checking if behind remote...")
            _run_git_command(['fetch', 'origin'])
            local = _run_git_command(['rev-parse', '@'])
            remote = _run_git_command(['rev-parse', '@{u}'])
            status['behind_remote'] = local != remote
            print(f"[Git Sync] Behind remote: {status['behind_remote']}")
        except GitSyncError as e:
            # Remote might not exist yet
            print(f"[Git Sync] Could not check remote status: {e}")
            pass

    except GitSyncError as e:
        print(f"[Git Sync] Error getting detailed status: {e}")
        pass

    print(f"[Git Sync] Final status: {status}\n")
    return status
