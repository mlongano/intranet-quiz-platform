"""The administrator-managed endpoint allowlist.

What matters here is not CRUD mechanics but the properties the security model
rests on: only enabled rows are ever resolved for grading, there is never more
than one default, and the endpoint address stays server-side.
"""

import pytest

from services import llm_config, llm_endpoints
from services.llm_errors import LlmConfigurationError
from tests.conftest import make_teacher, teacher_token


def _payload(**overrides):
    base = {
        'slug': 'lan-vllm',
        'label': 'Server scuola (vLLM)',
        'protocol': 'openai',
        'base_url': 'http://10.0.0.5:8000/v1',
        'requires_key': False,
        'models': ['qwen2.5:14b'],
        'enabled': True,
        'is_default': False,
    }
    base.update(overrides)
    return base


@pytest.fixture(autouse=True)
def clean_endpoints(db_conn):
    db_conn.execute("DELETE FROM llm_endpoints")
    db_conn.commit()
    yield
    db_conn.execute("DELETE FROM llm_endpoints")
    db_conn.commit()


# ── CRUD ─────────────────────────────────────────────────────────────────────

def test_create_and_list(db_conn):
    created = llm_endpoints.create_endpoint(_payload())

    assert created['slug'] == 'lan-vllm'
    assert created['requires_key'] is False
    assert created['models'] == ['qwen2.5:14b']

    listed = llm_endpoints.list_endpoints()
    assert [e['slug'] for e in listed] == ['lan-vllm']


def test_update_merges_onto_existing(db_conn):
    created = llm_endpoints.create_endpoint(_payload())

    updated = llm_endpoints.update_endpoint(created['id'], {'label': 'Nuovo nome'})

    assert updated['label'] == 'Nuovo nome'
    assert updated['base_url'] == 'http://10.0.0.5:8000/v1'  # untouched
    assert updated['slug'] == 'lan-vllm'


def test_duplicate_slug_is_rejected(db_conn):
    llm_endpoints.create_endpoint(_payload())

    from werkzeug.exceptions import Conflict
    with pytest.raises(Conflict):
        llm_endpoints.create_endpoint(_payload(label='Altro'))


def test_delete_removes_the_row(db_conn):
    created = llm_endpoints.create_endpoint(_payload())
    llm_endpoints.delete_endpoint(created['id'])

    assert llm_endpoints.list_endpoints() == []


def test_default_endpoint_cannot_be_deleted(db_conn):
    """Deleting it would move grading back to the environment without warning."""
    created = llm_endpoints.create_endpoint(_payload(is_default=True))

    from werkzeug.exceptions import Conflict
    with pytest.raises(Conflict, match='predefinito'):
        llm_endpoints.delete_endpoint(created['id'])


# ── validation ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize('bad_slug', ['', 'Has Spaces', 'trailing-', '-leading', 'has_underscore'])
def test_invalid_slug_is_rejected(db_conn, bad_slug):
    from werkzeug.exceptions import BadRequest
    with pytest.raises(BadRequest):
        llm_endpoints.create_endpoint(_payload(slug=bad_slug))


def test_slug_case_is_normalised_not_rejected(db_conn):
    created = llm_endpoints.create_endpoint(_payload(slug='LAN-VLLM'))
    assert created['slug'] == 'lan-vllm'


def test_unsupported_protocol_is_rejected(db_conn):
    from werkzeug.exceptions import BadRequest
    with pytest.raises(BadRequest, match='Protocollo'):
        llm_endpoints.create_endpoint(_payload(protocol='ollama'))


@pytest.mark.parametrize('bad_url', ['10.0.0.5:8000', 'ftp://host/v1', 'https://'])
def test_malformed_base_url_is_rejected(db_conn, bad_url):
    from werkzeug.exceptions import BadRequest
    with pytest.raises(BadRequest):
        llm_endpoints.create_endpoint(_payload(base_url=bad_url))


def test_credentials_in_url_are_rejected(db_conn):
    """They would leak into logs and into job provenance."""
    from werkzeug.exceptions import BadRequest
    with pytest.raises(BadRequest, match='credenziali'):
        llm_endpoints.create_endpoint(_payload(base_url='https://user:pw@host/v1'))


def test_hosted_endpoint_needs_no_base_url(db_conn):
    created = llm_endpoints.create_endpoint(
        _payload(slug='openai-hosted', base_url=None, requires_key=True)
    )
    assert created['base_url'] is None


# ── the single-default invariant ─────────────────────────────────────────────

def test_promoting_a_default_demotes_the_previous_one(db_conn):
    first = llm_endpoints.create_endpoint(_payload(is_default=True))
    second = llm_endpoints.create_endpoint(
        _payload(slug='openai-hosted', base_url=None, requires_key=True, is_default=True)
    )

    assert llm_endpoints.get_endpoint(first['id'])['is_default'] is False
    assert llm_endpoints.get_endpoint(second['id'])['is_default'] is True
    assert sum(e['is_default'] for e in llm_endpoints.list_endpoints()) == 1


def test_updating_to_default_demotes_the_previous_one(db_conn):
    first = llm_endpoints.create_endpoint(_payload(is_default=True))
    second = llm_endpoints.create_endpoint(_payload(slug='second', base_url=None))

    llm_endpoints.update_endpoint(second['id'], {'is_default': True})

    assert llm_endpoints.get_endpoint(first['id'])['is_default'] is False
    assert sum(e['is_default'] for e in llm_endpoints.list_endpoints()) == 1


# ── resolution for grading ───────────────────────────────────────────────────

def test_disabled_endpoint_is_never_resolved(db_conn):
    """Disabling is how an endpoint is revoked, so it must stop resolving."""
    created = llm_endpoints.create_endpoint(_payload(is_default=True))
    assert llm_endpoints.get_default_endpoint() is not None

    llm_endpoints.update_endpoint(created['id'], {'enabled': False})

    assert llm_endpoints.get_default_endpoint() is None
    assert llm_endpoints.resolve_enabled_endpoint(created['id']) is None


def test_grading_config_prefers_the_default_endpoint(db_conn, monkeypatch):
    llm_endpoints.create_endpoint(_payload(is_default=True))
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.setenv('LLM_PROVIDER', 'anthropic')      # must lose to the table
    monkeypatch.setenv('LLM_BASE_URL', 'http://ignored') # must lose to the table
    monkeypatch.delenv('LLM_MODEL', raising=False)
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)

    config = llm_config.resolve_llm_config()

    assert config['provider'] == 'openai'
    assert config['base_url'] == 'http://10.0.0.5:8000/v1'
    assert config['model'] == 'qwen2.5:14b'   # the endpoint's only model
    assert config['api_key'] == llm_config.LOCAL_ENDPOINT_PLACEHOLDER_KEY
    assert config['endpoint_slug'] == 'lan-vllm'


def test_env_is_used_when_no_default_endpoint_exists(db_conn, monkeypatch):
    llm_endpoints.create_endpoint(_payload(is_default=False))
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.setenv('LLM_PROVIDER', 'openai')
    monkeypatch.setenv('LLM_MODEL', 'gpt-4o-mini')
    monkeypatch.setenv('OPENAI_API_KEY', 'sk-env')
    monkeypatch.delenv('LLM_BASE_URL', raising=False)

    config = llm_config.resolve_llm_config()

    assert config['model'] == 'gpt-4o-mini'
    assert config['base_url'] is None
    assert 'endpoint_id' not in config


def test_endpoint_requiring_a_key_still_demands_one(db_conn, monkeypatch):
    llm_endpoints.create_endpoint(
        _payload(slug='openai-hosted', base_url=None, requires_key=True,
                 models=['gpt-4o-mini'], is_default=True)
    )
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    monkeypatch.delenv('LLM_MODEL', raising=False)

    with pytest.raises(LlmConfigurationError, match='OPENAI_API_KEY'):
        llm_config.resolve_llm_config()


def test_public_info_names_the_endpoint_but_not_its_address(db_conn, monkeypatch):
    llm_endpoints.create_endpoint(_payload(is_default=True))
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.delenv('LLM_MODEL', raising=False)

    info = llm_config.public_llm_info()

    assert info['endpoint'] == 'Server scuola (vLLM)'
    assert '10.0.0.5' not in str(info)


def test_resolution_reuses_a_held_connection(db_conn, monkeypatch):
    """Never take a second connection while one is held.

    Job creation runs inside the transaction that records a submission. Taking
    another connection there exhausts the pool under concurrent submissions —
    which is exactly how this regressed once.
    """
    llm_endpoints.create_endpoint(_payload(is_default=True))
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.delenv('LLM_MODEL', raising=False)

    import db as db_module
    calls = []
    original = db_module.get_conn

    def counting_get_conn(*args, **kwargs):
        calls.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(db_module, 'get_conn', counting_get_conn)

    config = llm_config.resolve_llm_config(conn=db_conn)

    assert config['endpoint_slug'] == 'lan-vllm'
    assert calls == [], "resolution must not open its own connection when given one"


# ── API surface ──────────────────────────────────────────────────────────────

def test_endpoints_api_requires_super_admin(client, db_conn):
    teacher_id = make_teacher(db_conn, email='plain-teacher@test.it')
    token = teacher_token(teacher_id, email='plain-teacher@test.it')

    response = client.get(
        '/api/super-admin/llm-endpoints',
        headers={'Authorization': f'Bearer {token}'},
    )
    assert response.status_code == 403


def test_super_admin_can_manage_endpoints(client, db_conn):
    admin_id = make_teacher(db_conn, email='root@test.it', role='super_admin')
    headers = {'Authorization': f"Bearer {teacher_token(admin_id, role='super_admin', email='root@test.it')}"}

    created = client.post('/api/super-admin/llm-endpoints', json=_payload(), headers=headers)
    assert created.status_code == 201
    endpoint_id = created.get_json()['id']

    listed = client.get('/api/super-admin/llm-endpoints', headers=headers)
    assert listed.status_code == 200
    assert len(listed.get_json()) == 1

    updated = client.put(
        f'/api/super-admin/llm-endpoints/{endpoint_id}',
        json={'label': 'Rinominato'}, headers=headers,
    )
    assert updated.status_code == 200
    assert updated.get_json()['label'] == 'Rinominato'

    deleted = client.delete(
        f'/api/super-admin/llm-endpoints/{endpoint_id}', headers=headers
    )
    assert deleted.status_code == 200
    assert client.get('/api/super-admin/llm-endpoints', headers=headers).get_json() == []
