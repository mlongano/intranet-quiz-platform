"""Resolving which provider, model and credentials to grade with.

This is the seam Fase 4 replaces. Today the answer comes from the environment
and is the same for every teacher; when per-teacher encrypted credentials land,
only `resolve_llm_config` changes body — its callers and the provider transport
stay as they are.

Keeping it separate from services/llm_errors.py matters because that module is
imported by grading and must stay free of configuration policy.
"""

from __future__ import annotations

import os

from services.llm_errors import LlmConfigurationError, llm_enabled
from services.llm_provider import SUPPORTED_PROVIDERS

# provider -> environment variable holding its API key
PROVIDER_KEY_ENV = {
    'openai': 'OPENAI_API_KEY',
    'anthropic': 'ANTHROPIC_API_KEY',
    'deepseek': 'DEEPSEEK_API_KEY',
}

DEFAULT_PROVIDER = 'openai'

# Sent to endpoints that need no authentication. The SDKs refuse to build a
# client without a key, so something has to be there; naming it makes an
# unauthenticated endpoint obvious in a stack trace instead of looking like a
# real credential.
LOCAL_ENDPOINT_PLACEHOLDER_KEY = 'no-key-required'


def resolve_llm_config(teacher_id: int | None = None, conn=None) -> dict:
    """Return {provider, model, api_key, base_url, params} for a grading call.

    *teacher_id* is accepted and ignored: it marks the call sites Fase 4 will
    need, so adding per-teacher credentials does not become a signature change
    rippling through the worker.

    Raises LlmConfigurationError when the setup is incomplete — the worker turns
    that into a preserved `pending`, never a zero.
    """
    endpoint = _default_endpoint(conn)

    if endpoint is not None:
        provider = endpoint['protocol']
        base_url = endpoint['base_url']
        requires_key = endpoint['requires_key']
    else:
        provider = (os.getenv('LLM_PROVIDER') or DEFAULT_PROVIDER).strip().lower()
        base_url = (os.getenv('LLM_BASE_URL') or '').strip() or None
        # Without a managed endpoint, a custom address is the only signal that
        # this is a LAN server which may not authenticate.
        requires_key = base_url is None

    if provider not in SUPPORTED_PROVIDERS:
        raise LlmConfigurationError(
            f"LLM provider {provider!r} is not supported. "
            f"Choose one of: {', '.join(SUPPORTED_PROVIDERS)}."
        )

    model = _resolve_model(endpoint)
    if not model:
        raise LlmConfigurationError("LLM_MODEL is not set.")

    # A key is what the hosted providers authenticate with, so it is required
    # when talking to them. A LAN endpoint (vLLM, llama.cpp, LiteLLM) commonly
    # has no auth at all; demanding a key there would only teach admins to put
    # junk in a variable named API_KEY. Both SDKs still need *some* string, so a
    # placeholder is sent. Set the key anyway if the endpoint checks it.
    key_env = PROVIDER_KEY_ENV[provider]
    api_key = (os.getenv(key_env) or '').strip()
    if not api_key:
        if requires_key:
            raise LlmConfigurationError(
                f"{key_env} is not set (required for provider {provider!r})."
            )
        api_key = LOCAL_ENDPOINT_PLACEHOLDER_KEY

    config = {
        'provider': provider,
        'model': model,
        'api_key': api_key,
        'base_url': base_url,
        'params': {
            'timeout_seconds': float(os.getenv('LLM_TIMEOUT_SECONDS', '25')),
            'retries': int(os.getenv('LLM_RETRIES', '0')),
        },
    }
    if endpoint is not None:
        # Recorded as provenance so a grade can name the endpoint that produced
        # it. The URL is still re-resolved from the table on every call.
        config['endpoint_id'] = endpoint['id']
        config['endpoint_slug'] = endpoint['slug']
    return config


def _default_endpoint(conn=None) -> dict | None:
    """The managed endpoint grading should use, if the table names one.

    Returns None when the table is empty, unreachable, or has no enabled
    default — the caller then falls back to the environment, so an
    installation that never populates it keeps working unchanged.
    """
    from services.llm_endpoints import get_default_endpoint

    return get_default_endpoint(conn)


def _resolve_model(endpoint: dict | None) -> str:
    """LLM_MODEL wins; a single-model endpoint supplies its own default.

    An endpoint that lists exactly one model needs no further configuration,
    which is the common case for a LAN server serving one weight.
    """
    model = (os.getenv('LLM_MODEL') or '').strip()
    if model:
        return model
    if endpoint and len(endpoint.get('models') or []) == 1:
        return endpoint['models'][0]
    return ''


def validate_llm_env() -> None:
    """Startup check: if grading is switched on, it must be fully configured.

    Called by server.py and the grading worker so a half-configured deployment
    fails loudly at boot instead of silently leaving every open answer pending.
    """
    if not llm_enabled():
        return
    resolve_llm_config()


_DISABLED_INFO = {
    'enabled': False, 'use_llm': False,
    'provider': None, 'model': None, 'endpoint': None,
}


def public_llm_info() -> dict:
    """Non-secret description of the active configuration, for the teacher UI.

    Names the managed endpoint by its label when one is in use, so a teacher
    can tell school-server grading from a hosted provider. Never returns the
    API key or the endpoint address.
    """
    if not llm_enabled():
        return dict(_DISABLED_INFO)
    try:
        config = resolve_llm_config()
    except LlmConfigurationError:
        return dict(_DISABLED_INFO)

    endpoint_label = None
    if config.get('endpoint_id'):
        from services.llm_endpoints import get_default_endpoint

        endpoint = get_default_endpoint()
        endpoint_label = endpoint['label'] if endpoint else None

    return {
        'enabled': True,
        'use_llm': True,
        'provider': config['provider'],
        'model': config['model'],
        'endpoint': endpoint_label,
    }
