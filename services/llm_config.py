"""Resolving where to grade, with which model, and with whose key.

The access model, in full:

- a super-admin decides *where* grading may go — the llm_endpoints allowlist,
  one endpoint marked default — and nothing else;
- a teacher grades only with their *own* key for that endpoint
  (services/credentials.py). There is no shared key: not per endpoint, not in
  .env. Every call is therefore attributable to the teacher who made it.

A teacher without a key for their endpoint is not an error state of the
system: their open answers stay pending, to be graded by hand or regraded once
they set one. Resolution raises LlmConfigurationError and the worker records
that on the answer — it never becomes a zero.

Keeping this apart from services/llm_errors.py matters because that module is
imported by grading and must stay free of configuration policy.
"""

from __future__ import annotations

import os

import db
from db import queries as Q
from services.llm_errors import LlmConfigurationError, llm_enabled
from services.llm_provider import SUPPORTED_PROVIDERS

NO_ENDPOINT_MESSAGE = (
    "Nessun endpoint di valutazione attivo: un super-admin deve abilitarne uno "
    "e renderlo predefinito."
)


def resolve_destination(teacher_id: int | None = None, conn=None) -> dict:
    """The endpoint and model a teacher's grading goes to. No secrets involved.

    The teacher's selected endpoint wins while it is still enabled; otherwise
    the default does. A teacher's model choice applies only to the endpoint it
    was made for, and only if that endpoint serves it — a revoked selection
    redirects grading to the default without dragging the old choice along.

    Raises LlmConfigurationError when there is nowhere to grade.
    """
    teacher = _teacher_preferences(teacher_id, conn)
    selected = _teacher_endpoint(teacher, conn)
    endpoint = selected or _default_endpoint(conn)
    if endpoint is None:
        raise LlmConfigurationError(NO_ENDPOINT_MESSAGE)
    if endpoint['protocol'] not in SUPPORTED_PROVIDERS:
        raise LlmConfigurationError(
            f"Protocollo {endpoint['protocol']!r} non supportato per l'endpoint "
            f"'{endpoint['slug']}'."
        )

    choices_apply = selected is not None or not teacher.get('endpoint_id')
    model = _resolve_model(endpoint, teacher if choices_apply else None)
    if not model:
        raise LlmConfigurationError(
            f"L'endpoint '{endpoint['slug']}' non elenca alcun modello."
        )
    return {'endpoint': endpoint, 'model': model}


def resolve_llm_config(teacher_id: int | None = None, conn=None) -> dict:
    """Return {provider, model, api_key, base_url, params, endpoint_*} for a call.

    The key is the teacher's own key *for the resolved endpoint* — the only key
    that may ever be sent there. With no such key this raises, and the answers
    stay pending.

    Pass *conn* when the caller already holds one: job creation runs inside the
    transaction that records a submission, and taking a second pooled
    connection there exhausts the pool under concurrent submissions.
    """
    destination = resolve_destination(teacher_id, conn)
    endpoint = destination['endpoint']

    api_key = _teacher_api_key(teacher_id, endpoint['id'], conn)
    if not api_key:
        raise LlmConfigurationError(
            f"Nessuna chiave personale per «{endpoint['label']}»: impostala in "
            f"Impostazioni → Valutazione. Fino ad allora le risposte aperte "
            f"restano da valutare."
        )

    return {
        'provider': endpoint['protocol'],
        'model': destination['model'],
        'api_key': api_key,
        'base_url': endpoint['base_url'],
        'params': {
            'timeout_seconds': float(os.getenv('LLM_TIMEOUT_SECONDS', '25')),
            'retries': int(os.getenv('LLM_RETRIES', '0')),
        },
        # Recorded as provenance so a grade can name the endpoint that produced
        # it. The URL is still re-resolved from the table on every call.
        'endpoint_id': endpoint['id'],
        'endpoint_slug': endpoint['slug'],
    }


def validate_llm_env() -> None:
    """Startup check. Warns; never stops the app.

    The allowlist is edited at runtime, so "no endpoint enabled" is a state an
    administrator can create at any moment. Refusing to boot over it would let
    disabling the only endpoint take quizzes offline at the next restart, when
    the right outcome is simply that open answers wait. Keys are not checked
    here at all: they belong to teachers, and a teacher without one is normal.
    """
    if not llm_enabled():
        return
    try:
        resolve_destination()
    except LlmConfigurationError as exc:
        print(f"[LLM] WARNING: grading is switched on but cannot run: {exc} "
              f"Open answers stay pending until it can.", flush=True)


def _default_endpoint(conn=None) -> dict | None:
    from services.llm_endpoints import get_default_endpoint

    return get_default_endpoint(conn)


def _teacher_preferences(teacher_id: int | None, conn=None) -> dict:
    """Non-secret LLM preferences stored on the teacher row.

    Returns {} on any failure — a teacher with no configuration, or a database
    that cannot be read right now, falls back to the default endpoint.
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


def _teacher_api_key(teacher_id: int | None, endpoint_id: int, conn=None) -> str:
    if not teacher_id:
        return ''
    try:
        from services.credentials import get_teacher_key

        return get_teacher_key(teacher_id, endpoint_id, conn) or ''
    except Exception:
        # An undecryptable key (master key rotated without re-encrypting) is
        # treated as absent: answers stay pending and the teacher re-enters it.
        return ''


def _resolve_model(endpoint: dict, teacher: dict | None = None) -> str:
    """The teacher's choice if this endpoint serves it, else its first model.

    The endpoint's list is part of the allowlist: nothing outside it is ever
    sent. *teacher* is None when the teacher's choice does not apply here.
    """
    served = list(endpoint.get('models') or [])
    chosen = str((teacher or {}).get('model') or '').strip()
    if chosen and chosen in served:
        return chosen
    return served[0] if served else ''


_DISABLED_INFO = {
    'enabled': False, 'use_llm': False,
    'provider': None, 'model': None, 'endpoint': None, 'key_configured': False,
}


def public_llm_info(teacher_id: int | None = None) -> dict:
    """Non-secret description of *this teacher's* grading, for the UI.

    ``enabled`` is true only when grading would actually run for them — an
    endpoint resolves and they hold a usable key for it — so the UI never
    advertises a model that cannot grade. ``key_configured`` lets it say why.
    Never returns a key or an endpoint address.
    """
    if not llm_enabled():
        return dict(_DISABLED_INFO)
    try:
        destination = resolve_destination(teacher_id)
    except LlmConfigurationError:
        return dict(_DISABLED_INFO)

    endpoint = destination['endpoint']
    key_configured = bool(_teacher_api_key(teacher_id, endpoint['id']))
    return {
        'enabled': key_configured,
        'use_llm': key_configured,
        'provider': endpoint['protocol'],
        'model': destination['model'],
        'endpoint': endpoint['label'],
        'key_configured': key_configured,
    }
