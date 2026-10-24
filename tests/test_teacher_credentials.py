"""Per-teacher LLM credentials.

The properties worth guarding are all about what must *not* happen: the key
must not be readable from the database alone, must not come back out of any
API, must not be stored for an endpoint outside the allowlist, and must not be
lost or silently corrupted when the master key rotates. Which key a grading
call uses is specified in test_llm_config.py.
"""

import json

import pytest

from services import credentials, llm_endpoints
from services.credentials import CredentialEncryptionError
from tests.conftest import make_teacher, teacher_token

MASTER_KEY = 'HFPRJdEBqzUCFqLZfPXKQzr1FN0hkOxlrn-9m3ZfJnE='
OTHER_KEY = '5Z6Yb4XBiTXQhLPq7vs0FN9NUKz-lU5rTQ1BvY_zVzs='


@pytest.fixture(autouse=True)
def master_key(monkeypatch):
    monkeypatch.setenv(credentials.MASTER_KEY_ENV, MASTER_KEY)


def _endpoint(**kw):
    payload = {
        'slug': 'school', 'label': 'Server scuola', 'protocol': 'openai',
        'base_url': 'https://llm.school.example/v1', 'models': ['qwen3-27b'],
        'enabled': True, 'is_default': True,
    }
    payload.update(kw)
    return llm_endpoints.create_endpoint(payload)


def _headers(teacher_id, email):
    return {'Authorization': f"Bearer {teacher_token(teacher_id, email=email)}"}


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
    school = _endpoint()
    teacher_id = make_teacher(db_conn, email='cred-store@test.it')
    credentials.set_teacher_key(teacher_id, school['id'], 'sk-super-secret')

    row = db_conn.execute(
        "SELECT ciphertext, fingerprint FROM teacher_llm_credentials WHERE teacher_id = %s",
        (teacher_id,),
    ).fetchone()

    assert 'sk-super-secret' not in row[0]
    assert 'sk-super-secret' not in row[1]
    assert credentials.get_teacher_key(teacher_id, school['id']) == 'sk-super-secret'


def test_keys_are_kept_per_endpoint(db_conn):
    school = _endpoint()
    lab = _endpoint(slug='lab', base_url='http://10.0.0.9/v1', is_default=False)
    teacher_id = make_teacher(db_conn, email='cred-per@test.it')
    credentials.set_teacher_key(teacher_id, school['id'], 'sk-school')
    credentials.set_teacher_key(teacher_id, lab['id'], 'sk-lab')

    assert credentials.get_teacher_key(teacher_id, school['id']) == 'sk-school'
    assert credentials.get_teacher_key(teacher_id, lab['id']) == 'sk-lab'


def test_replacing_a_key_overwrites_it(db_conn):
    school = _endpoint()
    teacher_id = make_teacher(db_conn, email='cred-replace@test.it')
    credentials.set_teacher_key(teacher_id, school['id'], 'sk-first')
    credentials.set_teacher_key(teacher_id, school['id'], 'sk-second')

    assert credentials.get_teacher_key(teacher_id, school['id']) == 'sk-second'
    count = db_conn.execute(
        "SELECT count(*) FROM teacher_llm_credentials WHERE teacher_id = %s", (teacher_id,)
    ).fetchone()[0]
    assert count == 1


def test_clearing_a_key_removes_only_that_one(db_conn):
    school = _endpoint()
    lab = _endpoint(slug='lab', base_url='http://10.0.0.9/v1', is_default=False)
    teacher_id = make_teacher(db_conn, email='cred-clear@test.it')
    credentials.set_teacher_key(teacher_id, school['id'], 'sk-gone')
    credentials.set_teacher_key(teacher_id, lab['id'], 'sk-stays')

    credentials.clear_teacher_key(teacher_id, school['id'])

    assert credentials.get_teacher_key(teacher_id, school['id']) is None
    assert credentials.get_teacher_key(teacher_id, lab['id']) == 'sk-stays'


def test_deleting_an_endpoint_deletes_the_keys_for_it(db_conn):
    lab = _endpoint(slug='lab', is_default=False)
    teacher_id = make_teacher(db_conn, email='cred-cascade@test.it')
    credentials.set_teacher_key(teacher_id, lab['id'], 'sk-orphan')

    llm_endpoints.delete_endpoint(lab['id'])

    assert db_conn.execute("SELECT count(*) FROM teacher_llm_credentials").fetchone()[0] == 0


def test_empty_key_is_rejected(db_conn):
    from werkzeug.exceptions import BadRequest
    school = _endpoint()
    teacher_id = make_teacher(db_conn, email='cred-empty@test.it')
    with pytest.raises(BadRequest):
        credentials.set_teacher_key(teacher_id, school['id'], '   ')


# ── rotation ─────────────────────────────────────────────────────────────────

def test_re_encrypt_all_moves_every_credential_to_the_new_key(db_conn):
    school = _endpoint()
    lab = _endpoint(slug='lab', base_url='http://10.0.0.9/v1', is_default=False)
    first = make_teacher(db_conn, email='rot-1@test.it')
    second = make_teacher(db_conn, email='rot-2@test.it')
    credentials.set_teacher_key(first, school['id'], 'sk-one')
    credentials.set_teacher_key(first, lab['id'], 'sk-one-lab')
    credentials.set_teacher_key(second, school['id'], 'sk-two')

    moved = credentials.re_encrypt_all(MASTER_KEY, OTHER_KEY, db_conn)
    db_conn.commit()

    assert moved == 3
    rows = db_conn.execute(
        "SELECT teacher_id, endpoint_id, ciphertext FROM teacher_llm_credentials"
    ).fetchall()
    # Readable with the new key...
    secrets = {(r[0], r[1]): credentials.decrypt(r[2], OTHER_KEY) for r in rows}
    assert secrets == {
        (first, school['id']): 'sk-one',
        (first, lab['id']): 'sk-one-lab',
        (second, school['id']): 'sk-two',
    }
    # ...and no longer with the old one.
    with pytest.raises(CredentialEncryptionError):
        credentials.decrypt(rows[0][2], MASTER_KEY)


def test_rotation_is_all_or_nothing(db_conn):
    """A partial rotation would leave rows nobody can decrypt."""
    school = _endpoint()
    teacher_id = make_teacher(db_conn, email='rot-atomic@test.it')
    credentials.set_teacher_key(teacher_id, school['id'], 'sk-keep')

    with pytest.raises(CredentialEncryptionError):
        # Wrong "old" key: nothing can be decrypted, so nothing must change.
        credentials.re_encrypt_all(OTHER_KEY, MASTER_KEY, db_conn)
    db_conn.rollback()

    assert credentials.get_teacher_key(teacher_id, school['id']) == 'sk-keep'


# ── API surface ──────────────────────────────────────────────────────────────

def test_settings_api_never_returns_the_key(client, db_conn):
    school = _endpoint()
    teacher_id = make_teacher(db_conn, email='api-key@test.it')
    headers = _headers(teacher_id, 'api-key@test.it')
    url = f"/api/teacher/llm-settings/endpoints/{school['id']}/key"

    saved = client.put(url, json={'api_key': 'sk-never-returned'}, headers=headers)
    assert saved.status_code == 200
    assert 'sk-never-returned' not in json.dumps(saved.get_json())
    entry = saved.get_json()['available_endpoints'][0]
    assert entry['key']['configured'] is True
    assert entry['key']['fingerprint'] == credentials.fingerprint('sk-never-returned')
    assert saved.get_json()['effective_endpoint_id'] == school['id']

    fetched = client.get('/api/teacher/llm-settings', headers=headers)
    assert 'sk-never-returned' not in json.dumps(fetched.get_json())

    cleared = client.delete(url, headers=headers)
    assert cleared.get_json()['available_endpoints'][0]['key']['configured'] is False


@pytest.mark.parametrize('which', ['missing', 'disabled'])
def test_a_key_cannot_be_stored_for_an_endpoint_outside_the_list(client, db_conn, which):
    disabled = _endpoint(slug='off', enabled=False, is_default=False)
    target = 999999 if which == 'missing' else disabled['id']
    teacher_id = make_teacher(db_conn, email=f'api-outside-{which}@test.it')

    response = client.put(f'/api/teacher/llm-settings/endpoints/{target}/key',
                          json={'api_key': 'sk-x'}, headers=_headers(teacher_id, 'x@test.it'))

    assert response.status_code == 400
    assert db_conn.execute("SELECT count(*) FROM teacher_llm_credentials").fetchone()[0] == 0


def test_key_storage_without_a_master_key_is_a_clear_conflict(client, db_conn, monkeypatch):
    school = _endpoint()
    teacher_id = make_teacher(db_conn, email='api-nomaster@test.it')
    monkeypatch.delenv(credentials.MASTER_KEY_ENV)

    response = client.put(f"/api/teacher/llm-settings/endpoints/{school['id']}/key",
                          json={'api_key': 'sk-x'}, headers=_headers(teacher_id, 'n@test.it'))

    assert response.status_code == 409


def test_teacher_cannot_select_an_endpoint_outside_the_list(client, db_conn):
    """The whole guarantee: a teacher names an id, and only an approved one."""
    teacher_id = make_teacher(db_conn, email='api-escape@test.it')

    response = client.put('/api/teacher/llm-settings', json={'endpoint_id': 999999},
                          headers=_headers(teacher_id, 'api-escape@test.it'))
    assert response.status_code == 400


def test_teacher_cannot_choose_a_model_outside_the_list(client, db_conn):
    _endpoint()
    teacher_id = make_teacher(db_conn, email='api-model@test.it')

    response = client.put('/api/teacher/llm-settings', json={'model': 'gpt-4o'},
                          headers=_headers(teacher_id, 'api-model@test.it'))
    assert response.status_code == 400


def test_teacher_cannot_supply_a_url(client, db_conn):
    """base_url is not a teacher-writable field; passing one changes nothing."""
    _endpoint()
    teacher_id = make_teacher(db_conn, email='api-url@test.it')

    client.put('/api/teacher/llm-settings',
               json={'base_url': 'http://169.254.169.254/latest/meta-data'},
               headers=_headers(teacher_id, 'api-url@test.it'))

    stored = db_conn.execute(
        "SELECT llm_config FROM teachers WHERE id = %s", (teacher_id,)
    ).fetchone()[0]
    assert 'base_url' not in stored
