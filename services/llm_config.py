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

import db
from db import queries as Q
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

    Precedence, most specific first: the teacher's own choice of endpoint and
    model, then the endpoint marked default, then the environment. A teacher's
    stored API key is preferred over the shared one from the environment, so a
    school-wide key keeps working for everyone who has not set their own.

    A teacher's configuration names an endpoint *by id*, and the URL is looked
    up here every time. That is what makes disabling an endpoint take effect
    immediately, including for teachers who had already selected it.

    Raises LlmConfigurationError when the setup is incomplete — the worker turns
    that into a preserved `pending`, never a zero.
    """
    teacher = _teacher_preferences(teacher_id, conn)
    selected = _teacher_endpoint(teacher, conn)
    endpoint = selected or _default_endpoint(conn)
    # A teacher's model and key were chosen for the endpoint they selected —
    # or, having selected none, for whatever grading uses. When a selection is
    # revoked they fall back to the default, but their choices do not follow.
    teacher_choices_apply = selected is not None or not teacher.get('endpoint_id')

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

    model = _resolve_model(endpoint, teacher if teacher_choices_apply else None)
    if not model:
        raise LlmConfigurationError("LLM_MODEL is not set.")

    # A key goes only to the destination it was issued for. Choosing the
    # fallback by protocol alone used to send OPENAI_API_KEY — a key for
    # api.openai.com — to any OpenAI-compatible host an endpoint named.
    #
    #   teacher key   -> the endpoint they selected; with no selection, only the
    #                    provider's own hosted service
    #   endpoint key  -> that endpoint
    #   key from .env -> the provider's own hosted service, or the address .env
    #                    itself configures, which the admin paired with it
    key_env = PROVIDER_KEY_ENV[provider]
    hosted_by_provider = base_url is None
    api_key = ''
    if selected is not None or (teacher_choices_apply and hosted_by_provider):
        api_key = _teacher_api_key(teacher_id, conn)
    if not api_key and endpoint is not None:
        api_key = _endpoint_api_key(endpoint['id'], conn)
    if not api_key and (endpoint is None or hosted_by_provider):
        api_key = (os.getenv(key_env) or '').strip()

    # A LAN endpoint (vLLM, llama.cpp) commonly has no auth at all; demanding a
    # key there would only teach admins to put junk in a variable named
    # API_KEY. Both SDKs still need *some* string, so a placeholder is sent.
    if not api_key:
        if requires_key:
            raise LlmConfigurationError(_missing_key_message(endpoint, provider, key_env))
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


def _teacher_preferences(teacher_id: int | None, conn=None) -> dict:
    """Non-secret LLM preferences stored on the teacher row.

    Returns {} on any failure — a teacher with no configuration, or a database
    that cannot be read right now, must fall back to the shared setup rather
    than stop grading.
    """
    if not teacher_id:
        return {}
    try:
        if conn is not None:
            row = conn.execute(Q.GET_TEACHER_LLM_CONFIG, (teacher_id,)).fetchone()
        else:
            with db.get_conn() as owned:
                row = owned.execute(Q.GET_TEACHER_LLM_CONFIG, (teacher_id,)).fetchone()
    except Exception:
        return {}
    if not row or not isinstance(row[0], dict):
        return {}
    return row[0]


def _teacher_endpoint(teacher: dict, conn=None) -> dict | None:
    """The endpoint a teacher selected, if it is still enabled.

    A selection that no longer resolves — endpoint disabled or deleted — falls
    through to the default rather than failing: revocation should redirect
    grading, not break it.
    """
    endpoint_id = teacher.get('endpoint_id')
    if not endpoint_id:
        return None
    from services.llm_endpoints import resolve_enabled_endpoint

    return resolve_enabled_endpoint(int(endpoint_id), conn)


def _missing_key_message(endpoint: dict | None, provider: str, key_env: str) -> str:
    if endpoint is not None and endpoint['base_url'] is not None:
        return (
            f"Nessuna chiave API configurata per l'endpoint '{endpoint['slug']}': "
            f"impostala nella gestione endpoint del super-admin, oppure nelle tue "
            f"impostazioni se hai selezionato questo endpoint."
        )
    return (
        f"Nessuna chiave API configurata per il provider {provider!r}: "
        f"impostala nelle tue impostazioni oppure definisci {key_env}."
    )


def _endpoint_api_key(endpoint_id: int, conn=None) -> str:
    try:
        from services.credentials import get_endpoint_key

        return get_endpoint_key(endpoint_id, conn) or ''
    except Exception:
        # Same policy as a teacher key: unreadable means absent, so the caller
        # either finds another key that belongs here or reports one missing.
        return ''


def _teacher_api_key(teacher_id: int | None, conn=None) -> str:
    if not teacher_id:
        return ''
    try:
        from services.credentials import get_teacher_key

        return get_teacher_key(teacher_id, conn) or ''
    except Exception:
        # A key that cannot be decrypted must not stop the shared configuration
        # from working; the teacher is told to re-enter it in their settings.
        return ''


def _resolve_model(endpoint: dict | None, teacher: dict | None = None) -> str:
    """Teacher's choice, then LLM_MODEL, then the endpoint's first listed model.

    An endpoint that lists models serves only those, so a choice it does not
    serve is skipped rather than sent: LLM_MODEL in .env usually names a hosted
    model, and forcing it onto a school server would fail every call. The
    first listed model is therefore the endpoint's default, and a single-model
    LAN server needs no further configuration. *teacher* is None when the
    teacher's choices do not apply to this endpoint.
    """
    served = list((endpoint or {}).get('models') or [])

    def servable(name: str) -> bool:
        return bool(name) and (not served or name in served)

    chosen = str((teacher or {}).get('model') or '').strip()
    if servable(chosen):
        return chosen
    model = (os.getenv('LLM_MODEL') or '').strip()
    if servable(model):
        return model
    return served[0] if served else ''


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
