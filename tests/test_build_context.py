"""What must never be baked into the Docker image.

`COPY . .` sends the whole build context into the image layers. The Google
service-account key in secrets/ carries domain-wide delegation — it can act as
a Workspace administrator — and until this test existed it was copied into
every image, world-readable. Credentials are mounted at runtime instead.
"""

import os
from pathlib import Path

# In the test container the image's own copy of root-level files is stale by
# construction; compose-debug.yaml mounts the working tree at REPO_ROOT.
ROOT = Path(os.environ.get('REPO_ROOT') or Path(__file__).resolve().parents[1])


def _ignored() -> set[str]:
    lines = (ROOT / '.dockerignore').read_text().splitlines()
    return {line.split('#')[0].strip() for line in lines if line.strip() and not line.startswith('#')}


def test_credentials_never_enter_the_build_context():
    ignored = _ignored()
    for pattern in ('.env', 'secrets/'):
        assert pattern in ignored, f"{pattern} must be listed in .dockerignore"


def test_legacy_student_files_never_enter_the_build_context():
    """Leftover v2.6.0 student lists are personal data, not application code."""
    assert 'students.jsonc*' in _ignored()


def test_the_key_is_mounted_read_only_at_runtime_instead():
    compose = (ROOT / 'compose.yaml').read_text()
    assert './secrets:/app/secrets:ro' in compose
