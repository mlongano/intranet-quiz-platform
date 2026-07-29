"""Per-teacher LLM credentials.

The properties worth guarding are all about what must *not* happen: the key
must not be readable from the database alone, must not come back out of any
API, and must not be lost or silently corrupted when the master key rotates.
"""

import json

import pytest

from services import credentials, llm_config, llm_endpoints, teacher_llm_settings
from services.credentials import CredentialEncryptionError
from tests.conftest import make_teacher, teacher_token

MASTER_KEY = 'HFPRJdEBqzUCFqLZfPXKQzr1FN0hkOxlrn-9m3ZfJnE='
OTHER_KEY = '5Z6Yb4XBiTXQhLPq7vs0FN9NUKz-lU5rTQ1BvY_zVzs='


@pytest.fixture(autouse=True)
def master_key(monkeypatch):
    monkeypatch.setenv(credentials.MASTER_KEY_ENV, MASTER_KEY)


@pytest.fixture(autouse=True)
def clean(db_conn):
    db_conn.execute("DELETE FROM teacher_llm_credentials")
    db_conn.execute("DELETE FROM llm_endpoints")
    db_conn.commit()
    yield
    db_conn.execute("DELETE FROM teacher_llm_credentials")
    db_conn.execute("DELETE FROM llm_endpoints")
    db_conn.commit()


# ── encryption ───────────────────────────────────────────────────────────────

def test_roundtrip():
    token = credentials.encrypt('sk-secret-value')
    assert credentials.decrypt(token) == 'sk-secret-value'


def test_ciphertext_does_not_contain_the_secret():
    token = credentials.encrypt('sk-secret-value')
    assert 'sk-secret-value' not in token


def test_same_secret_encrypts_differently_each_time():
    """Fernet nonces make ciphertexts unlinkable; equal keys must not look equal."""
    assert credentials.encrypt('sk-same') != credentials.encrypt('sk-same')


def test_wrong_master_key_cannot_decrypt():
    token = credentials.encrypt('sk-secret-value', MASTER_KEY)
    with pytest.raises(CredentialEncryptionError):
        credentials.decrypt(token, OTHER_KEY)


def test_tampered_ciphertext_is_rejected_not_silently_wrong():
    token = credentials.encrypt('sk-secret-value')
    tampered = token[:-4] + ('AAAA' if not token.endswith('AAAA') else 'BBBB')
    with pytest.raises(CredentialEncryptionError):
        credentials.decrypt(tampered)


def test_missing_master_key_is_a_clear_error_that_does_not_echo_it(monkeypatch):
    monkeypatch.delenv(credentials.MASTER_KEY_ENV, raising=False)
    with pytest.raises(CredentialEncryptionError, match='CREDENTIAL_ENCRYPTION_KEY'):
        credentials.encrypt('sk-x')


def test_invalid_master_key_error_does_not_leak_its_value(monkeypatch):
    monkeypatch.setenv(credentials.MASTER_KEY_ENV, 'not-a-valid-fernet-key')
    with pytest.raises(CredentialEncryptionError) as excinfo:
        credentials.encrypt('sk-x')
    assert 'not-a-valid-fernet-key' not in str(excinfo.value)


def test_fingerprint_is_stable_and_not_the_secret():
    assert credentials.fingerprint('sk-abc') == credentials.fingerprint('sk-abc')
    assert credentials.fingerprint('sk-abc') != credentials.fingerprint('sk-abd')
    assert 'sk-abc' not in credentials.fingerprint('sk-abc')


# ── storage ──────────────────────────────────────────────────────────────────

def test_stored_key_is_not_readable_from_the_database_alone(db_conn):
    teacher_id = make_teacher(db_conn, email='cred-store@test.it')
    credentials.set_teacher_key(teacher_id, 'sk-super-secret')

    row = db_conn.execute(
        "SELECT ciphertext, fingerprint FROM teacher_llm_credentials WHERE teacher_id = %s",
        (teacher_id,),
    ).fetchone()

    assert 'sk-super-secret' not in row[0]
    assert 'sk-super-secret' not in row[1]
    assert credentials.get_teacher_key(teacher_id) == 'sk-super-secret'


def test_replacing_a_key_overwrites_it(db_conn):
    teacher_id = make_teacher(db_conn, email='cred-replace@test.it')
    credentials.set_teacher_key(teacher_id, 'sk-first')
    credentials.set_teacher_key(teacher_id, 'sk-second')

    assert credentials.get_teacher_key(teacher_id) == 'sk-second'
    count = db_conn.execute(
        "SELECT count(*) FROM teacher_llm_credentials WHERE teacher_id = %s", (teacher_id,)
    ).fetchone()[0]
    assert count == 1


def test_clearing_a_key_removes_it(db_conn):
    teacher_id = make_teacher(db_conn, email='cred-clear@test.it')
    credentials.set_teacher_key(teacher_id, 'sk-gone')
    credentials.clear_teacher_key(teacher_id)

    assert credentials.get_teacher_key(teacher_id) is None


def test_empty_key_is_rejected(db_conn):
    from werkzeug.exceptions import BadRequest
    teacher_id = make_teacher(db_conn, email='cred-empty@test.it')
    with pytest.raises(BadRequest):
        credentials.set_teacher_key(teacher_id, '   ')


# ── rotation ─────────────────────────────────────────────────────────────────

def test_re_encrypt_all_moves_every_credential_to_the_new_key(db_conn):
    first = make_teacher(db_conn, email='rot-1@test.it')
    second = make_teacher(db_conn, email='rot-2@test.it')
    credentials.set_teacher_key(first, 'sk-one')
    credentials.set_teacher_key(second, 'sk-two')

    moved = credentials.re_encrypt_all(MASTER_KEY, OTHER_KEY, db_conn)
    db_conn.commit()

    assert moved == 2
    # Readable with the new key...
    rows = db_conn.execute(
        "SELECT teacher_id, ciphertext FROM teacher_llm_credentials ORDER BY teacher_id"
    ).fetchall()
    secrets = {r[0]: credentials.decrypt(r[1], OTHER_KEY) for r in rows}
    assert secrets == {first: 'sk-one', second: 'sk-two'}
    # ...and no longer with the old one.
    with pytest.raises(CredentialEncryptionError):
        credentials.decrypt(rows[0][1], MASTER_KEY)


def test_rotation_is_all_or_nothing(db_conn):
    """A partial rotation would leave rows nobody can decrypt."""
    teacher_id = make_teacher(db_conn, email='rot-atomic@test.it')
    credentials.set_teacher_key(teacher_id, 'sk-keep')

    with pytest.raises(CredentialEncryptionError):
        # Wrong "old" key: nothing can be decrypted, so nothing must change.
        credentials.re_encrypt_all(OTHER_KEY, MASTER_KEY, db_conn)
    db_conn.rollback()

    assert credentials.get_teacher_key(teacher_id) == 'sk-keep'


# ── resolution ───────────────────────────────────────────────────────────────

def _endpoint(**kw):
    payload = {
        'slug': 'hosted', 'label': 'OpenAI', 'protocol': 'openai',
        'base_url': None, 'requires_key': True, 'models': ['gpt-4o-mini'],
        'enabled': True, 'is_default': True,
    }
    payload.update(kw)
    return llm_endpoints.create_endpoint(payload)


def test_teacher_key_is_preferred_over_the_shared_one(db_conn, monkeypatch):
    _endpoint()
    teacher_id = make_teacher(db_conn, email='res-own@test.it')
    credentials.set_teacher_key(teacher_id, 'sk-teacher-own')
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.setenv('OPENAI_API_KEY', 'sk-shared')
    monkeypatch.delenv('LLM_MODEL', raising=False)

    assert llm_config.resolve_llm_config(teacher_id=teacher_id)['api_key'] == 'sk-teacher-own'


def test_shared_key_still_applies_to_teachers_without_one(db_conn, monkeypatch):
    _endpoint()
    teacher_id = make_teacher(db_conn, email='res-shared@test.it')
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.setenv('OPENAI_API_KEY', 'sk-shared')
    monkeypatch.delenv('LLM_MODEL', raising=False)

    assert llm_config.resolve_llm_config(teacher_id=teacher_id)['api_key'] == 'sk-shared'


def test_teacher_endpoint_and_model_win(db_conn, monkeypatch):
    _endpoint()
    lan = _endpoint(slug='lan', label='LAN', base_url='http://10.0.0.5:8000/v1',
                    requires_key=False, models=['qwen2.5:14b', 'llama3.3:70b'],
                    is_default=False)
    teacher_id = make_teacher(db_conn, email='res-choice@test.it')
    teacher_llm_settings.update_settings(
        teacher_id, {'endpoint_id': lan['id'], 'model': 'llama3.3:70b'}
    )
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.setenv('LLM_MODEL', 'gpt-4o-mini')

    config = llm_config.resolve_llm_config(teacher_id=teacher_id)

    assert config['base_url'] == 'http://10.0.0.5:8000/v1'
    assert config['model'] == 'llama3.3:70b'
    assert config['endpoint_slug'] == 'lan'


def test_disabling_an_endpoint_redirects_that_teacher_to_the_default(db_conn, monkeypatch):
    """Revocation must take effect immediately, without breaking grading."""
    _endpoint()
    lan = _endpoint(slug='lan', label='LAN', base_url='http://10.0.0.5:8000/v1',
                    requires_key=False, models=['qwen2.5:14b'], is_default=False)
    teacher_id = make_teacher(db_conn, email='res-revoked@test.it')
    teacher_llm_settings.update_settings(teacher_id, {'endpoint_id': lan['id']})
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.setenv('OPENAI_API_KEY', 'sk-shared')
    monkeypatch.delenv('LLM_MODEL', raising=False)

    llm_endpoints.update_endpoint(lan['id'], {'enabled': False})

    config = llm_config.resolve_llm_config(teacher_id=teacher_id)
    assert config['endpoint_slug'] == 'hosted'   # fell back to the default


def test_undecryptable_key_does_not_break_grading(db_conn, monkeypatch):
    """A key from a previous master key must not stop the shared setup working."""
    _endpoint()
    teacher_id = make_teacher(db_conn, email='res-badkey@test.it')
    credentials.set_teacher_key(teacher_id, 'sk-old-era')
    monkeypatch.setenv(credentials.MASTER_KEY_ENV, OTHER_KEY)   # rotated without re-encrypting
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.setenv('OPENAI_API_KEY', 'sk-shared')
    monkeypatch.delenv('LLM_MODEL', raising=False)

    assert llm_config.resolve_llm_config(teacher_id=teacher_id)['api_key'] == 'sk-shared'


# ── API surface ──────────────────────────────────────────────────────────────

def test_settings_api_never_returns_the_key(client, db_conn):
    _endpoint()
    teacher_id = make_teacher(db_conn, email='api-key@test.it')
    headers = {'Authorization': f"Bearer {teacher_token(teacher_id, email='api-key@test.it')}"}

    saved = client.put('/api/teacher/llm-settings/key',
                       json={'api_key': 'sk-never-returned'}, headers=headers)
    assert saved.status_code == 200
    assert 'sk-never-returned' not in json.dumps(saved.get_json())
    assert saved.get_json()['key']['configured'] is True
    assert saved.get_json()['key']['fingerprint'] == credentials.fingerprint('sk-never-returned')

    fetched = client.get('/api/teacher/llm-settings', headers=headers)
    assert 'sk-never-returned' not in json.dumps(fetched.get_json())

    cleared = client.delete('/api/teacher/llm-settings/key', headers=headers)
    assert cleared.get_json()['key']['configured'] is False


def test_teacher_cannot_select_an_endpoint_outside_the_list(client, db_conn):
    """The whole guarantee: a teacher names an id, and only an approved one."""
    teacher_id = make_teacher(db_conn, email='api-escape@test.it')
    headers = {'Authorization': f"Bearer {teacher_token(teacher_id, email='api-escape@test.it')}"}

    response = client.put('/api/teacher/llm-settings',
                          json={'endpoint_id': 999999}, headers=headers)
    assert response.status_code == 400


def test_teacher_cannot_supply_a_url(client, db_conn):
    """base_url is not a teacher-writable field; passing one changes nothing."""
    _endpoint()
    teacher_id = make_teacher(db_conn, email='api-url@test.it')
    headers = {'Authorization': f"Bearer {teacher_token(teacher_id, email='api-url@test.it')}"}

    client.put('/api/teacher/llm-settings',
               json={'base_url': 'http://169.254.169.254/latest/meta-data'}, headers=headers)

    stored = db_conn.execute(
        "SELECT llm_config FROM teachers WHERE id = %s", (teacher_id,)
    ).fetchone()[0]
    assert 'base_url' not in stored
