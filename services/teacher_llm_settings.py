"""A teacher's own LLM configuration.

Splits cleanly in two, and the split is the security boundary:

- preferences (which endpoint, which model) live in ``teachers.llm_config`` and
  are freely readable;
- the API key lives encrypted in ``teacher_llm_credentials`` and is never
  returned by any endpoint — reads report only whether one is set and its
  fingerprint.

The endpoint is stored as an id, never a URL, so the administrator's list stays
the authority on what grading may contact.
"""

from __future__ import annotations

import json

from werkzeug.exceptions import BadRequest

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

    return {
        'endpoint_id': selected['id'] if selected else None,
        # A selection whose endpoint was disabled reads as unset, matching how
        # grading resolves it — the teacher is not shown a choice that no
        # longer applies.
        'endpoint_label': selected['label'] if selected else None,
        'model': config.get('model') or None,
        'available_endpoints': [
            {
                'id': e['id'],
                'label': e['label'],
                'protocol': e['protocol'],
                'requires_key': e['requires_key'],
                'models': e['models'],
                'is_default': e['is_default'],
            }
            for e in llm_endpoints.list_endpoints() if e['enabled']
        ],
        'key': credentials.describe_teacher_key(teacher_id),
        'encryption_available': credentials.encryption_available(),
    }


def update_settings(teacher_id: int, payload: dict) -> dict:
    """Store endpoint and model choices. Rejects an endpoint outside the list."""
    config: dict = {}

    endpoint_id = payload.get('endpoint_id')
    if endpoint_id not in (None, ''):
        try:
            endpoint_id = int(endpoint_id)
        except (TypeError, ValueError):
            raise BadRequest(description="Endpoint non valido.")
        # Membership of the administrator's list is the whole guarantee: this
        # is where a teacher is prevented from naming an arbitrary destination.
        if llm_endpoints.resolve_enabled_endpoint(endpoint_id) is None:
            raise BadRequest(description="L'endpoint selezionato non è disponibile.")
        config['endpoint_id'] = endpoint_id

    model = payload.get('model')
    if model not in (None, ''):
        config['model'] = str(model).strip()

    with db.get_conn() as conn:
        conn.execute(Q.UPDATE_TEACHER_LLM_CONFIG, {
            'teacher_id': teacher_id,
            'llm_config': json.dumps(config),
        })
        conn.commit()

    return get_settings(teacher_id)


def set_key(teacher_id: int, secret: str) -> dict:
    credentials.set_teacher_key(teacher_id, secret)
    return get_settings(teacher_id)


def clear_key(teacher_id: int) -> dict:
    credentials.clear_teacher_key(teacher_id)
    return get_settings(teacher_id)
