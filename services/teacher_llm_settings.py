"""A teacher's own LLM configuration.

Splits cleanly in two, and the split is the security boundary:

- preferences (which endpoint, which model) live in ``teachers.llm_config`` and
  are freely readable;
- the teacher's API keys live encrypted in ``teacher_llm_credentials``, one per
  endpoint, and are never returned by any endpoint — reads report only whether
  one is set and its fingerprint.

A key is the *only* way a teacher's answers get graded: there is no shared
key. Everything a teacher can name — endpoint, model, the endpoint a key is
for — is checked against the administrator's allowlist, so the list stays the
authority on what grading may contact.
"""

from __future__ import annotations

import json

from werkzeug.exceptions import BadRequest, Conflict

import db
from db import queries as Q
from services import credentials, llm_endpoints


def get_settings(teacher_id: int) -> dict:
    """Everything the teacher may see about their own configuration."""
    with db.get_conn() as conn:
        row = conn.execute(Q.GET_TEACHER_LLM_CONFIG, (teacher_id,)).fetchone()
    config = row[0] if row and isinstance(row[0], dict) else {}

    endpoint_id = config.get('endpoint_id')
    selected = (
        llm_endpoints.resolve_enabled_endpoint(int(endpoint_id))
        if endpoint_id else None
    )
    default = llm_endpoints.get_default_endpoint()
    effective = selected or default
    keys = credentials.describe_teacher_keys(teacher_id)

    return {
        'endpoint_id': selected['id'] if selected else None,
        # A selection whose endpoint was disabled reads as unset, matching how
        # grading resolves it — the teacher is not shown a choice that no
        # longer applies.
        'endpoint_label': selected['label'] if selected else None,
        'model': config.get('model') or None,
        # The endpoint grading actually uses for this teacher, so the page can
        # say whether *that* one has a key.
        'effective_endpoint_id': effective['id'] if effective else None,
        'available_endpoints': [
            {
                'id': e['id'],
                'label': e['label'],
                'protocol': e['protocol'],
                'models': e['models'],
                'is_default': e['is_default'],
                'key': keys.get(e['id'], credentials.key_status()),
            }
            for e in llm_endpoints.list_endpoints() if e['enabled']
        ],
        'encryption_available': credentials.encryption_available(),
    }


def update_settings(teacher_id: int, payload: dict) -> dict:
    """Store endpoint and model choices. Both must come from the allowlist."""
    config: dict = {}

    endpoint = None
    endpoint_id = payload.get('endpoint_id')
    if endpoint_id not in (None, ''):
        # Membership of the administrator's list is the whole guarantee: this
        # is where a teacher is prevented from naming an arbitrary destination.
        endpoint = _enabled_endpoint(endpoint_id)
        config['endpoint_id'] = endpoint['id']

    model = str(payload.get('model') or '').strip()
    if model:
        target = endpoint or llm_endpoints.get_default_endpoint()
        if target is None or model not in target['models']:
            raise BadRequest(description="Il modello scelto non è tra quelli ammessi per questo servizio.")
        config['model'] = model

    with db.get_conn() as conn:
        conn.execute(Q.UPDATE_TEACHER_LLM_CONFIG, {
            'teacher_id': teacher_id,
            'llm_config': json.dumps(config),
        })
        conn.commit()

    return get_settings(teacher_id)


def set_key(teacher_id: int, endpoint_id, secret: str) -> dict:
    """Store the teacher's key for one whitelisted endpoint."""
    endpoint = _enabled_endpoint(endpoint_id)
    if not credentials.encryption_available():
        raise Conflict(description=(
            "Il server non può conservare chiavi: manca CREDENTIAL_ENCRYPTION_KEY. "
            "Contatta l'amministratore."
        ))
    credentials.set_teacher_key(teacher_id, endpoint['id'], secret)
    return get_settings(teacher_id)


def clear_key(teacher_id: int, endpoint_id) -> dict:
    credentials.clear_teacher_key(teacher_id, _as_id(endpoint_id))
    return get_settings(teacher_id)


def _enabled_endpoint(endpoint_id) -> dict:
    endpoint = llm_endpoints.resolve_enabled_endpoint(_as_id(endpoint_id))
    if endpoint is None:
        raise BadRequest(description="L'endpoint selezionato non è disponibile.")
    return endpoint


def _as_id(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        raise BadRequest(description="Endpoint non valido.")
