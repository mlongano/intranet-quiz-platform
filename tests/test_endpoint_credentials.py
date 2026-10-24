"""Per-endpoint API keys, and the rule that every key stays at its destination.

The bug this pins down: the fallback key used to be chosen by *protocol*, so any
OpenAI-compatible endpoint received OPENAI_API_KEY — a key issued for
api.openai.com — as its bearer token. Making a LAN or school server the default
would have handed the school's OpenAI key to it for every teacher without one
of their own.

The rule now, for keys and for models alike: a credential or a choice is only
ever used at the destination it was made for.

- an endpoint's stored key goes to that endpoint only;
- a teacher's key goes to the endpoint they selected, or — if they selected
  none — to the provider's own hosted service only;
- the shared key from .env goes to the provider's own hosted service, or to the
  destination .env itself configures (the admin paired those two).
"""

import pytest

from services import credentials, llm_config, llm_endpoints, teacher_llm_settings
from services.llm_errors import LlmConfigurationError
from tests.conftest import make_teacher, teacher_token

MASTER_KEY = 'HFPRJdEBqzUCFqLZfPXKQzr1FN0hkOxlrn-9m3ZfJnE='
OTHER_KEY = '5Z6Yb4XBiTXQhLPq7vs0FN9NUKz-lU5rTQ1BvY_zVzs='
SHARED = 'sk-shared-openai-key'


@pytest.fixture(autouse=True)
def env(monkeypatch):
    # The test container inherits the real .env: pin everything that matters.
    monkeypatch.setenv(credentials.MASTER_KEY_ENV, MASTER_KEY)
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.setenv('LLM_PROVIDER', 'openai')
    monkeypatch.setenv('OPENAI_API_KEY', SHARED)
    for var in ('LLM_MODEL', 'LLM_BASE_URL', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY'):
        monkeypatch.delenv(var, raising=False)


@pytest.fixture(autouse=True)
def clean(db_conn):
    def wipe():
        db_conn.execute("DELETE FROM llm_endpoint_credentials")
        db_conn.execute("DELETE FROM teacher_llm_credentials")
        db_conn.execute("UPDATE teachers SET llm_config = '{}'::jsonb")
        db_conn.execute("DELETE FROM llm_endpoints")
        db_conn.commit()
    wipe()
    yield
    wipe()


def _endpoint(**kw):
    payload = {
        'slug': 'school', 'label': 'Server scuola', 'protocol': 'openai',
        'base_url': 'https://llm.school.example/v1', 'requires_key': True,
        'models': ['qwen3-27b'], 'enabled': True, 'is_default': True,
    }
    payload.update(kw)
    return llm_endpoints.create_endpoint(payload)


def _admin_headers(db_conn):
    admin_id = make_teacher(db_conn, email='root-ep@test.it', role='super_admin')
    token = teacher_token(admin_id, role='super_admin', email='root-ep@test.it')
    return {'Authorization': f'Bearer {token}'}


# ── the shared key stays with the hosted provider ────────────────────────────

def test_shared_key_is_never_sent_to_an_endpoint_with_its_own_address():
    _endpoint(requires_key=False)

    config = llm_config.resolve_llm_config()

    assert config['api_key'] != SHARED
    assert config['api_key'] == llm_config.LOCAL_ENDPOINT_PLACEHOLDER_KEY


def test_endpoint_needing_a_key_fails_rather_than_borrow_the_shared_one():
    """Failing leaves answers pending; borrowing would leak the OpenAI key."""
    _endpoint(requires_key=True)

    with pytest.raises(LlmConfigurationError, match="school"):
        llm_config.resolve_llm_config()


def test_hosted_vendor_endpoint_still_uses_the_shared_key():
    _endpoint(slug='openai', base_url=None, models=['gpt-4o-mini'])

    assert llm_config.resolve_llm_config()['api_key'] == SHARED


def test_env_configured_address_keeps_the_key_env_pairs_with_it(monkeypatch):
    monkeypatch.setenv('LLM_BASE_URL', 'http://10.0.0.5:8000/v1')
    monkeypatch.setenv('LLM_MODEL', 'qwen2.5:14b')

    config = llm_config.resolve_llm_config()

    assert config['base_url'] == 'http://10.0.0.5:8000/v1'
    assert config['api_key'] == SHARED


# ── an endpoint's own key ────────────────────────────────────────────────────

def test_endpoint_key_is_used_for_its_endpoint():
    school = _endpoint()
    credentials.set_endpoint_key(school['id'], 'sk-litellm-virtual')

    assert llm_config.resolve_llm_config()['api_key'] == 'sk-litellm-virtual'


def test_endpoint_key_never_reaches_another_endpoint(db_conn):
    school = _endpoint()
    credentials.set_endpoint_key(school['id'], 'sk-school-only')
    lab = _endpoint(slug='lab', base_url='http://10.0.0.9:8000/v1',
                    requires_key=False, models=['llama'], is_default=False)
    teacher_id = make_teacher(db_conn, email='ep-other@test.it')
    teacher_llm_settings.update_settings(teacher_id, {'endpoint_id': lab['id']})

    config = llm_config.resolve_llm_config(teacher_id=teacher_id)

    assert config['endpoint_slug'] == 'lab'
    assert config['api_key'] == llm_config.LOCAL_ENDPOINT_PLACEHOLDER_KEY


def test_endpoint_key_is_encrypted_at_rest(db_conn):
    school = _endpoint()
    credentials.set_endpoint_key(school['id'], 'sk-plaintext-check')

    ciphertext, digest = db_conn.execute(
        "SELECT ciphertext, fingerprint FROM llm_endpoint_credentials WHERE endpoint_id = %s",
        (school['id'],),
    ).fetchone()
    assert 'sk-plaintext-check' not in ciphertext
    assert digest == credentials.fingerprint('sk-plaintext-check')


def test_deleting_an_endpoint_deletes_its_key(db_conn):
    lab = _endpoint(slug='lab', is_default=False)
    credentials.set_endpoint_key(lab['id'], 'sk-gone')

    llm_endpoints.delete_endpoint(lab['id'])

    assert db_conn.execute("SELECT count(*) FROM llm_endpoint_credentials").fetchone()[0] == 0


# ── a teacher's key goes where the teacher sent it ───────────────────────────

def test_teacher_key_without_a_selection_is_not_sent_to_a_lan_default(db_conn):
    school = _endpoint()
    credentials.set_endpoint_key(school['id'], 'sk-school')
    teacher_id = make_teacher(db_conn, email='ep-nosel@test.it')
    credentials.set_teacher_key(teacher_id, 'sk-teacher-openai')

    assert llm_config.resolve_llm_config(teacher_id=teacher_id)['api_key'] == 'sk-school'


def test_teacher_key_goes_to_the_endpoint_the_teacher_selected(db_conn):
    school = _endpoint()
    credentials.set_endpoint_key(school['id'], 'sk-school')
    teacher_id = make_teacher(db_conn, email='ep-sel@test.it')
    teacher_llm_settings.update_settings(teacher_id, {'endpoint_id': school['id']})
    credentials.set_teacher_key(teacher_id, 'sk-teacher-virtual')

    assert llm_config.resolve_llm_config(teacher_id=teacher_id)['api_key'] == 'sk-teacher-virtual'


def test_revoked_selection_does_not_carry_the_teacher_key_to_the_default(db_conn):
    school = _endpoint()
    credentials.set_endpoint_key(school['id'], 'sk-school')
    home = _endpoint(slug='home', base_url='https://home.example/v1',
                     models=['gemma'], is_default=False)
    teacher_id = make_teacher(db_conn, email='ep-revoked@test.it')
    teacher_llm_settings.update_settings(teacher_id, {'endpoint_id': home['id']})
    credentials.set_teacher_key(teacher_id, 'sk-for-home-only')

    llm_endpoints.update_endpoint(home['id'], {'enabled': False})
    config = llm_config.resolve_llm_config(teacher_id=teacher_id)

    assert config['endpoint_slug'] == 'school'
    assert config['api_key'] == 'sk-school'


# ── models follow the same rule ──────────────────────────────────────────────

def test_env_model_is_not_forced_onto_an_endpoint_that_does_not_serve_it(monkeypatch):
    _endpoint(requires_key=False)
    monkeypatch.setenv('LLM_MODEL', 'gpt-4o-mini')

    assert llm_config.resolve_llm_config()['model'] == 'qwen3-27b'


def test_env_model_is_kept_when_the_endpoint_serves_it(monkeypatch):
    _endpoint(requires_key=False, models=['qwen3-27b', 'gpt-4o-mini'])
    monkeypatch.setenv('LLM_MODEL', 'gpt-4o-mini')

    assert llm_config.resolve_llm_config()['model'] == 'gpt-4o-mini'


def test_first_listed_model_is_the_endpoint_default():
    _endpoint(requires_key=False, models=['qwen3-27b', 'gemma'])

    assert llm_config.resolve_llm_config()['model'] == 'qwen3-27b'


def test_teacher_model_does_not_follow_them_to_the_fallback_endpoint(db_conn):
    _endpoint(requires_key=False)
    home = _endpoint(slug='home', base_url='https://home.example/v1',
                     requires_key=False, models=['gemma'], is_default=False)
    teacher_id = make_teacher(db_conn, email='ep-model@test.it')
    teacher_llm_settings.update_settings(
        teacher_id, {'endpoint_id': home['id'], 'model': 'gemma'}
    )

    llm_endpoints.update_endpoint(home['id'], {'enabled': False})
    config = llm_config.resolve_llm_config(teacher_id=teacher_id)

    assert config['endpoint_slug'] == 'school'
    assert config['model'] == 'qwen3-27b'


# ── rotation ─────────────────────────────────────────────────────────────────

def test_rotation_re_encrypts_endpoint_keys_too(db_conn):
    school = _endpoint()
    credentials.set_endpoint_key(school['id'], 'sk-endpoint')
    teacher_id = make_teacher(db_conn, email='ep-rot@test.it')
    credentials.set_teacher_key(teacher_id, 'sk-teacher')

    count = credentials.re_encrypt_all(MASTER_KEY, OTHER_KEY, db_conn)
    db_conn.commit()

    assert count == 2
    (ciphertext,) = db_conn.execute(
        "SELECT ciphertext FROM llm_endpoint_credentials WHERE endpoint_id = %s", (school['id'],)
    ).fetchone()
    assert credentials.decrypt(ciphertext, OTHER_KEY) == 'sk-endpoint'


# ── API surface ──────────────────────────────────────────────────────────────

def test_api_sets_a_key_and_reports_only_its_fingerprint(client, db_conn):
    school = _endpoint()
    headers = _admin_headers(db_conn)

    response = client.put(f"/api/super-admin/llm-endpoints/{school['id']}/key",
                          json={'api_key': 'sk-never-echoed'}, headers=headers)
    assert response.status_code == 200
    assert 'sk-never-echoed' not in response.get_data(as_text=True)

    listed = client.get('/api/super-admin/llm-endpoints', headers=headers)
    body = listed.get_data(as_text=True)
    assert 'sk-never-echoed' not in body
    entry = listed.get_json()[0]
    assert entry['api_key'] == {
        'configured': True,
        'fingerprint': credentials.fingerprint('sk-never-echoed'),
        'updated_at': entry['api_key']['updated_at'],
    }
    assert 'ciphertext' not in body


def test_api_clears_a_key(client, db_conn):
    school = _endpoint()
    credentials.set_endpoint_key(school['id'], 'sk-to-clear')
    headers = _admin_headers(db_conn)

    response = client.delete(f"/api/super-admin/llm-endpoints/{school['id']}/key",
                             headers=headers)

    assert response.status_code == 200
    assert response.get_json()['configured'] is False
    entry = client.get('/api/super-admin/llm-endpoints', headers=headers).get_json()[0]
    assert entry['api_key']['configured'] is False


def test_api_rejects_an_empty_key(client, db_conn):
    school = _endpoint()

    response = client.put(f"/api/super-admin/llm-endpoints/{school['id']}/key",
                          json={'api_key': '   '}, headers=_admin_headers(db_conn))

    assert response.status_code == 400


def test_key_api_requires_super_admin(client, db_conn):
    school = _endpoint()
    teacher_id = make_teacher(db_conn, email='ep-plain@test.it')
    headers = {'Authorization': f'Bearer {teacher_token(teacher_id)}'}

    response = client.put(f"/api/super-admin/llm-endpoints/{school['id']}/key",
                          json={'api_key': 'sk-x'}, headers=headers)

    assert response.status_code == 403
