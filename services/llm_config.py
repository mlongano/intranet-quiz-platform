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


def resolve_llm_config(teacher_id: int | None = None) -> dict:
    """Return {provider, model, api_key, base_url, params} for a grading call.

    *teacher_id* is accepted and ignored: it marks the call sites Fase 4 will
    need, so adding per-teacher credentials does not become a signature change
    rippling through the worker.

    Raises LlmConfigurationError when the setup is incomplete — the worker turns
    that into a preserved `pending`, never a zero.
    """
    provider = (os.getenv('LLM_PROVIDER') or DEFAULT_PROVIDER).strip().lower()
    if provider not in SUPPORTED_PROVIDERS:
        raise LlmConfigurationError(
            f"LLM_PROVIDER={provider!r} is not supported. "
            f"Choose one of: {', '.join(SUPPORTED_PROVIDERS)}."
        )

    model = (os.getenv('LLM_MODEL') or '').strip()
    if not model:
        raise LlmConfigurationError("LLM_MODEL is not set.")

    base_url = (os.getenv('LLM_BASE_URL') or '').strip() or None

    # A key is what the hosted providers authenticate with, so it is required
    # when talking to them. A LAN endpoint (vLLM, llama.cpp, LiteLLM) commonly
    # has no auth at all; demanding a key there would only teach admins to put
    # junk in a variable named API_KEY. Both SDKs still need *some* string, so a
    # placeholder is sent. Set the key anyway if the LAN endpoint checks it.
    key_env = PROVIDER_KEY_ENV[provider]
    api_key = (os.getenv(key_env) or '').strip()
    if not api_key:
        if base_url is None:
            raise LlmConfigurationError(
                f"{key_env} is not set (required for provider {provider!r})."
            )
        api_key = LOCAL_ENDPOINT_PLACEHOLDER_KEY

    return {
        'provider': provider,
        'model': model,
        'api_key': api_key,
        'base_url': base_url,
        'params': {
            'timeout_seconds': float(os.getenv('LLM_TIMEOUT_SECONDS', '25')),
            'retries': int(os.getenv('LLM_RETRIES', '0')),
        },
    }


def validate_llm_env() -> None:
    """Startup check: if grading is switched on, it must be fully configured.

    Called by server.py and the grading worker so a half-configured deployment
    fails loudly at boot instead of silently leaving every open answer pending.
    """
    if not llm_enabled():
        return
    resolve_llm_config()


def public_llm_info() -> dict:
    """Non-secret description of the active configuration, for the teacher UI."""
    if not llm_enabled():
        return {'enabled': False, 'use_llm': False, 'provider': None, 'model': None}
    try:
        config = resolve_llm_config()
    except LlmConfigurationError:
        return {'enabled': False, 'use_llm': False, 'provider': None, 'model': None}
    return {
        'enabled': True,
        'use_llm': True,
        'provider': config['provider'],
        'model': config['model'],
    }
