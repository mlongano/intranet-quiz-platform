"""Who may grade, where, and with which key.

The access model this pins down:

- a super-admin decides *where* grading may go — the llm_endpoints allowlist —
  and nothing else; there are no shared keys;
- a teacher grades only with their *own* key, stored for one endpoint and sent
  to that endpoint only;
- .env supplies no destination, model or key any more. Configuration left
  there must be ignored, or it would be a way around the allowlist.

A teacher without a key is a normal state: their open answers stay pending.
"""

import pytest

from services import credentials, llm_config, llm_endpoints, teacher_llm_settings
from services.llm_config import public_llm_info, resolve_llm_config, validate_llm_env
from services.llm_errors import LlmConfigurationError
from tests.conftest import TEST_MASTER_KEY, make_teacher

OTHER_KEY = '5Z6Yb4XBiTXQhLPq7vs0FN9NUKz-lU5rTQ1BvY_zVzs='


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    # Legacy configuration a deployment may still carry: none of it may count.
    monkeypatch.setenv('LLM_PROVIDER', 'anthropic')
    monkeypatch.setenv('LLM_MODEL', 'gpt-4o-mini')
    monkeypatch.setenv('LLM_BASE_URL', 'http://legacy.example/v1')
    monkeypatch.setenv('OPENAI_API_KEY', 'sk-legacy-shared')
    monkeypatch.setenv('ANTHROPIC_API_KEY', 'sk-ant-legacy-shared')


def _endpoint(**kw):
    payload = {
        'slug': 'school', 'label': 'Server scuola', 'protocol': 'openai',
        'base_url': 'https://llm.school.example/v1',
        'models': ['qwen3-27b', 'gemma'], 'enabled': True, 'is_default': True,
    }
    payload.update(kw)
    return llm_endpoints.create_endpoint(payload)


def _teacher(db_conn, name):
    return make_teacher(db_conn, email=f'{name}@test.it')


# ── where grading goes ───────────────────────────────────────────────────────

def test_with_no_endpoint_there_is_nowhere_to_grade(db_conn):
    """.env still names a provider, model, URL and key: none of it is a destination."""
    teacher_id = _teacher(db_conn, 'nowhere')

    with pytest.raises(LlmConfigurationError, match='Nessun endpoint'):
        resolve_llm_config(teacher_id=teacher_id)


def test_default_endpoint_and_the_teachers_key(db_conn):
    school = _endpoint()
    teacher_id = _teacher(db_conn, 'plain')
    credentials.set_teacher_key(teacher_id, school['id'], 'sk-teacher-school')

    config = resolve_llm_config(teacher_id=teacher_id)

    assert config['provider'] == 'openai'
    assert config['base_url'] == 'https://llm.school.example/v1'
    assert config['model'] == 'qwen3-27b'             # first listed, not LLM_MODEL
    assert config['api_key'] == 'sk-teacher-school'
    assert config['endpoint_slug'] == 'school'


def test_anthropic_protocol_endpoint(db_conn):
    lab = _endpoint(slug='lab', protocol='anthropic', base_url='http://10.0.0.7:9000',
                    models=['local-claude'])
    teacher_id = _teacher(db_conn, 'anthropic')
    credentials.set_teacher_key(teacher_id, lab['id'], 'sk-ant-teacher')

    config = resolve_llm_config(teacher_id=teacher_id)

    assert (config['provider'], config['model'], config['api_key']) == \
        ('anthropic', 'local-claude', 'sk-ant-teacher')


def test_selected_endpoint_wins_while_enabled(db_conn):
    _endpoint()
    lab = _endpoint(slug='lab', base_url='http://10.0.0.9:8000/v1',
                    models=['llama'], is_default=False)
    teacher_id = _teacher(db_conn, 'selects')
    teacher_llm_settings.update_settings(teacher_id, {'endpoint_id': lab['id']})
    credentials.set_teacher_key(teacher_id, lab['id'], 'sk-lab')

    config = resolve_llm_config(teacher_id=teacher_id)

    assert (config['endpoint_slug'], config['api_key']) == ('lab', 'sk-lab')


# ── keys: personal, and bound to one endpoint ────────────────────────────────

def test_teacher_without_a_key_cannot_grade(db_conn):
    _endpoint()
    teacher_id = _teacher(db_conn, 'nokey')

    with pytest.raises(LlmConfigurationError, match='Server scuola'):
        resolve_llm_config(teacher_id=teacher_id)


def test_no_teacher_means_no_key(db_conn):
    _endpoint()

    with pytest.raises(LlmConfigurationError, match='chiave personale'):
        resolve_llm_config()


def test_a_key_is_never_sent_to_another_endpoint(db_conn):
    """A key for one service is not a credential for any other, default or not."""
    school = _endpoint(is_default=False)
    _endpoint(slug='other', base_url='https://other.example/v1', models=['m'])
    teacher_id = _teacher(db_conn, 'bound')
    credentials.set_teacher_key(teacher_id, school['id'], 'sk-for-school-only')

    with pytest.raises(LlmConfigurationError):
        resolve_llm_config(teacher_id=teacher_id)   # resolves 'other': no key there


def test_revoked_selection_falls_back_with_the_key_for_the_default(db_conn):
    school = _endpoint()
    home = _endpoint(slug='home', base_url='https://home.example/v1',
                     models=['gemma-home'], is_default=False)
    teacher_id = _teacher(db_conn, 'revoked')
    teacher_llm_settings.update_settings(teacher_id, {'endpoint_id': home['id'], 'model': 'gemma-home'})
    credentials.set_teacher_key(teacher_id, home['id'], 'sk-home')
    credentials.set_teacher_key(teacher_id, school['id'], 'sk-school')

    llm_endpoints.update_endpoint(home['id'], {'enabled': False})
    config = resolve_llm_config(teacher_id=teacher_id)

    assert config['endpoint_slug'] == 'school'
    assert config['api_key'] == 'sk-school'      # never the home key
    assert config['model'] == 'qwen3-27b'        # the home model did not follow


def test_undecryptable_key_counts_as_absent(db_conn, monkeypatch):
    school = _endpoint()
    teacher_id = _teacher(db_conn, 'oldkey')
    credentials.set_teacher_key(teacher_id, school['id'], 'sk-old-era')
    monkeypatch.setenv(credentials.MASTER_KEY_ENV, OTHER_KEY)   # rotated without re-encrypting

    with pytest.raises(LlmConfigurationError, match='chiave personale'):
        resolve_llm_config(teacher_id=teacher_id)


def test_shared_env_key_is_never_used(db_conn):
    _endpoint(slug='openai', base_url=None, models=['gpt-4o-mini'])
    teacher_id = _teacher(db_conn, 'envkey')

    with pytest.raises(LlmConfigurationError):
        resolve_llm_config(teacher_id=teacher_id)


# ── models come from the allowlist ───────────────────────────────────────────

def test_teacher_model_applies_when_the_endpoint_serves_it(db_conn):
    school = _endpoint()
    teacher_id = _teacher(db_conn, 'model')
    teacher_llm_settings.update_settings(teacher_id, {'model': 'gemma'})
    credentials.set_teacher_key(teacher_id, school['id'], 'sk')

    assert resolve_llm_config(teacher_id=teacher_id)['model'] == 'gemma'


def test_a_model_outside_the_list_is_never_sent(db_conn):
    """A stored choice the admin later removed from the list falls back to the first."""
    school = _endpoint()
    teacher_id = _teacher(db_conn, 'stale')
    teacher_llm_settings.update_settings(teacher_id, {'model': 'gemma'})
    credentials.set_teacher_key(teacher_id, school['id'], 'sk')

    llm_endpoints.update_endpoint(school['id'], {'models': ['qwen3-27b']})

    assert resolve_llm_config(teacher_id=teacher_id)['model'] == 'qwen3-27b'


# ── startup ──────────────────────────────────────────────────────────────────

def test_startup_check_is_silent_when_grading_is_off(db_conn, monkeypatch, capsys):
    monkeypatch.setenv('USE_LLM_EVAL', '0')

    validate_llm_env()

    assert capsys.readouterr().out == ''


def test_startup_warns_but_does_not_stop_without_an_endpoint(db_conn, capsys):
    """Disabling the only endpoint must not take quizzes offline at the next restart."""
    validate_llm_env()   # must not raise

    assert 'WARNING' in capsys.readouterr().out


def test_startup_does_not_need_any_key(db_conn, capsys):
    _endpoint()   # no teacher has a key: a normal state, not a misconfiguration

    validate_llm_env()

    assert capsys.readouterr().out == ''


# ── what the teacher UI is told ──────────────────────────────────────────────

def test_info_names_the_teachers_own_endpoint_and_key_state(db_conn):
    _endpoint()
    lab = _endpoint(slug='lab', label='Laboratorio', base_url='http://10.0.0.9:8000/v1',
                    models=['llama'], is_default=False)
    teacher_id = _teacher(db_conn, 'info')
    teacher_llm_settings.update_settings(teacher_id, {'endpoint_id': lab['id']})

    info = public_llm_info(teacher_id)
    assert info['endpoint'] == 'Laboratorio'      # not the default's label
    assert info['model'] == 'llama'
    assert (info['enabled'], info['key_configured']) == (False, False)

    credentials.set_teacher_key(teacher_id, lab['id'], 'sk-info-secret')
    info = public_llm_info(teacher_id)
    assert (info['enabled'], info['key_configured']) == (True, True)
    assert 'sk-info-secret' not in str(info)
    assert '10.0.0.9' not in str(info)


def test_info_is_disabled_without_an_endpoint(db_conn):
    assert public_llm_info(_teacher(db_conn, 'noinfo'))['enabled'] is False


def test_resolution_reuses_a_held_connection(db_conn, monkeypatch):
    """Never take a second connection while one is held.

    Job creation runs inside the transaction that records a submission. Taking
    another connection there exhausts the pool under concurrent submissions —
    which is exactly how this regressed once.
    """
    school = _endpoint()
    teacher_id = _teacher(db_conn, 'conn')
    credentials.set_teacher_key(teacher_id, school['id'], 'sk')

    import db as db_module
    calls = []
    original = db_module.get_conn
    monkeypatch.setattr(db_module, 'get_conn', lambda *a, **k: calls.append(1) or original(*a, **k))

    config = resolve_llm_config(teacher_id=teacher_id, conn=db_conn)

    assert config['api_key'] == 'sk'
    assert calls == [], "resolution must not open its own connection when given one"


def test_test_suite_never_uses_the_deployments_master_key():
    import os
    assert os.environ[credentials.MASTER_KEY_ENV] == TEST_MASTER_KEY
