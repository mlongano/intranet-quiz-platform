"""Resolving which provider, model and credentials to grade with.

This is the seam Fase 4 replaces with per-teacher credentials, so its current
behaviour is pinned here: what is required, what is optional, and what must
never leak to the teacher API.
"""

import pytest

from services.llm_config import (
    LOCAL_ENDPOINT_PLACEHOLDER_KEY,
    public_llm_info,
    resolve_llm_config,
    validate_llm_env,
)
from services.llm_errors import LlmConfigurationError


@pytest.fixture(autouse=True)
def clean_llm_env(monkeypatch):
    for var in ('USE_LLM_EVAL', 'LLM_PROVIDER', 'LLM_MODEL', 'LLM_BASE_URL',
                'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY'):
        monkeypatch.delenv(var, raising=False)


def _hosted(monkeypatch, **extra):
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.setenv('LLM_PROVIDER', 'openai')
    monkeypatch.setenv('LLM_MODEL', 'gpt-4o-mini')
    monkeypatch.setenv('OPENAI_API_KEY', 'sk-real')
    for key, value in extra.items():
        monkeypatch.setenv(key, value)


# ── hosted providers ─────────────────────────────────────────────────────────

def test_hosted_provider_resolves(monkeypatch):
    _hosted(monkeypatch)
    config = resolve_llm_config()

    assert config['provider'] == 'openai'
    assert config['model'] == 'gpt-4o-mini'
    assert config['api_key'] == 'sk-real'
    assert config['base_url'] is None


def test_hosted_provider_requires_its_key(monkeypatch):
    _hosted(monkeypatch)
    monkeypatch.delenv('OPENAI_API_KEY')

    with pytest.raises(LlmConfigurationError, match='OPENAI_API_KEY'):
        resolve_llm_config()


def test_unsupported_provider_is_rejected(monkeypatch):
    _hosted(monkeypatch, LLM_PROVIDER='ollama')

    with pytest.raises(LlmConfigurationError, match='not supported'):
        resolve_llm_config()


def test_model_is_required(monkeypatch):
    _hosted(monkeypatch)
    monkeypatch.delenv('LLM_MODEL')

    with pytest.raises(LlmConfigurationError, match='LLM_MODEL'):
        resolve_llm_config()


# ── LAN / self-hosted endpoints ──────────────────────────────────────────────

def test_lan_endpoint_works_without_a_key(monkeypatch):
    """vLLM and llama.cpp usually have no auth; a dummy key should not be needed."""
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.setenv('LLM_PROVIDER', 'openai')
    monkeypatch.setenv('LLM_MODEL', 'qwen2.5:14b')
    monkeypatch.setenv('LLM_BASE_URL', 'http://10.0.0.5:8000/v1')

    config = resolve_llm_config()

    assert config['base_url'] == 'http://10.0.0.5:8000/v1'
    assert config['api_key'] == LOCAL_ENDPOINT_PLACEHOLDER_KEY


def test_lan_endpoint_still_uses_a_real_key_when_given(monkeypatch):
    """Some LAN gateways (LiteLLM) do check a token."""
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.setenv('LLM_PROVIDER', 'openai')
    monkeypatch.setenv('LLM_MODEL', 'qwen2.5:14b')
    monkeypatch.setenv('LLM_BASE_URL', 'http://10.0.0.5:8000/v1')
    monkeypatch.setenv('OPENAI_API_KEY', 'lan-token')

    assert resolve_llm_config()['api_key'] == 'lan-token'


def test_anthropic_protocol_lan_endpoint_also_works(monkeypatch):
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.setenv('LLM_PROVIDER', 'anthropic')
    monkeypatch.setenv('LLM_MODEL', 'local-claude')
    monkeypatch.setenv('LLM_BASE_URL', 'http://10.0.0.7:9000')

    config = resolve_llm_config()
    assert config['provider'] == 'anthropic'
    assert config['api_key'] == LOCAL_ENDPOINT_PLACEHOLDER_KEY


# ── startup validation ───────────────────────────────────────────────────────

def test_validate_is_a_noop_when_grading_is_disabled(monkeypatch):
    monkeypatch.setenv('USE_LLM_EVAL', '0')
    monkeypatch.setenv('LLM_PROVIDER', 'nonsense')

    validate_llm_env()  # must not raise


def test_validate_rejects_half_configured_grading(monkeypatch):
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.setenv('LLM_PROVIDER', 'openai')
    monkeypatch.setenv('LLM_MODEL', 'gpt-4o-mini')

    with pytest.raises(LlmConfigurationError):
        validate_llm_env()


# ── what the teacher API may see ─────────────────────────────────────────────

def test_public_info_never_includes_the_key_or_endpoint(monkeypatch):
    _hosted(monkeypatch, LLM_BASE_URL='http://10.0.0.5:8000/v1')

    info = public_llm_info()

    assert info == {
        'enabled': True, 'use_llm': True,
        'provider': 'openai', 'model': 'gpt-4o-mini',
    }
    assert 'sk-real' not in str(info)
    assert '10.0.0.5' not in str(info)


def test_public_info_reports_disabled_when_misconfigured(monkeypatch):
    _hosted(monkeypatch)
    monkeypatch.delenv('OPENAI_API_KEY')

    info = public_llm_info()

    assert info['enabled'] is False
    assert info['model'] is None
