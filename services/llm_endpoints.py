"""Administrator-managed list of endpoints grading may talk to.

The list is what keeps the set of reachable hosts closed. A teacher will choose
from it by id (Fase 4) and never by URL, so there is no arbitrary URL to
validate and therefore no request-forgery surface — which is a stronger
guarantee than trying to validate a user-supplied address.

It is also the *only* thing an administrator controls about grading: there
are no shared keys. Each teacher authenticates to an endpoint with their own
key (services/credentials.py), so every call is attributable to a teacher.

Two rules follow from that and are enforced here rather than left to callers:

- grading only ever resolves an ``enabled`` row, so disabling one revokes it
  immediately, including for anyone who had already selected it;
- the URL is resolved from this table at call time and never copied into a
  teacher's configuration, or the list would stop being authoritative.
"""

from __future__ import annotations

import json
import re
from urllib.parse import urlparse

from werkzeug.exceptions import BadRequest, Conflict, NotFound

import db
from db import queries as Q
from services.llm_provider import SUPPORTED_PROVIDERS

# Must start and end alphanumeric: a trailing hyphen reads as a typo and makes
# the slug ugly wherever it appears in an audit trail. Input is lowercased
# first, so case is normalised rather than rejected.
SLUG_PATTERN = re.compile(r'^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$')


def list_endpoints() -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(Q.LIST_LLM_ENDPOINTS).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_endpoint(endpoint_id: int) -> dict:
    with db.get_conn() as conn:
        row = conn.execute(Q.GET_LLM_ENDPOINT, (endpoint_id,)).fetchone()
    if not row:
        raise NotFound(description="Endpoint non trovato.")
    return _row_to_dict(row)


def get_default_endpoint(conn=None) -> dict | None:
    """The endpoint grading uses when no teacher-specific choice applies.

    Pass *conn* when the caller already holds one. Acquiring a second
    connection while the first is held exhausts the pool under load — that is
    exactly what happens on submission, where this runs inside the transaction
    that records the score.

    Returns None rather than raising when the table is empty or unreachable:
    the caller falls back to the environment configuration, so an installation
    that never populates this table keeps working unchanged.
    """
    return _fetch_endpoint(Q.GET_DEFAULT_LLM_ENDPOINT, (), conn)


def resolve_enabled_endpoint(endpoint_id: int, conn=None) -> dict | None:
    """Look up one endpoint for grading. Disabled rows resolve to None."""
    return _fetch_endpoint(Q.GET_ENABLED_LLM_ENDPOINT, (endpoint_id,), conn)


def _fetch_endpoint(query: str, params: tuple, conn) -> dict | None:
    try:
        if conn is not None:
            row = conn.execute(query, params).fetchone()
        else:
            with db.get_conn() as owned:
                row = owned.execute(query, params).fetchone()
    except Exception:
        return None
    return _row_to_dict(row) if row else None


def create_endpoint(payload: dict) -> dict:
    fields = _validate(payload)
    with db.get_conn() as conn:
        if fields['is_default']:
            conn.execute(Q.CLEAR_DEFAULT_LLM_ENDPOINT, (None,))
        try:
            row = conn.execute(Q.INSERT_LLM_ENDPOINT, _as_params(fields)).fetchone()
        except Exception as exc:
            conn.rollback()
            raise _conflict_or_raise(exc, fields['slug'])
        conn.commit()
    return _row_to_dict(row)


def update_endpoint(endpoint_id: int, payload: dict) -> dict:
    existing = get_endpoint(endpoint_id)
    merged = {**existing, **payload}
    fields = _validate(merged)

    with db.get_conn() as conn:
        if fields['is_default']:
            # Demote any other default first: the unique index is checked per
            # statement, so promoting before demoting would collide.
            conn.execute(Q.CLEAR_DEFAULT_LLM_ENDPOINT, (endpoint_id,))
        try:
            row = conn.execute(
                Q.UPDATE_LLM_ENDPOINT, {**_as_params(fields), 'id': endpoint_id}
            ).fetchone()
        except Exception as exc:
            conn.rollback()
            raise _conflict_or_raise(exc, fields['slug'])
        if not row:
            conn.rollback()
            raise NotFound(description="Endpoint non trovato.")
        conn.commit()
    return _row_to_dict(row)


def delete_endpoint(endpoint_id: int) -> None:
    """Remove an endpoint outright.

    Disabling is the normal way to retire one that has been used, so its row
    can still explain historical evaluations. Deleting the current default is
    refused: it would silently move grading back to the environment
    configuration. Once jobs record endpoint_id (Fase 4), deletion should be
    refused for any referenced endpoint as well.
    """
    endpoint = get_endpoint(endpoint_id)
    if endpoint['is_default']:
        raise Conflict(
            description="Questo è l'endpoint predefinito: assegnane un altro prima di eliminarlo."
        )
    with db.get_conn() as conn:
        row = conn.execute(Q.DELETE_LLM_ENDPOINT, (endpoint_id,)).fetchone()
        if not row:
            conn.rollback()
            raise NotFound(description="Endpoint non trovato.")
        conn.commit()


# ── validation ───────────────────────────────────────────────────────────────

def _validate(payload: dict) -> dict:
    slug = str(payload.get('slug') or '').strip().lower()
    if not SLUG_PATTERN.match(slug):
        raise BadRequest(
            description="Slug non valido: usa lettere minuscole, cifre e trattini."
        )

    label = str(payload.get('label') or '').strip()
    if not label:
        raise BadRequest(description="Il nome visualizzato è obbligatorio.")

    protocol = str(payload.get('protocol') or '').strip().lower()
    if protocol not in SUPPORTED_PROVIDERS:
        raise BadRequest(
            description=f"Protocollo non supportato. Ammessi: {', '.join(SUPPORTED_PROVIDERS)}."
        )

    base_url = payload.get('base_url')
    base_url = str(base_url).strip() if base_url else None
    if base_url:
        base_url = _validate_base_url(base_url)

    # The list is part of the allowlist: an endpoint is only ever asked for a
    # model named here, and the first is what a teacher gets by default.
    # Nothing else supplies a model any more, so an empty list is refused.
    models = payload.get('models') or []
    if not isinstance(models, list) or any(not str(m).strip() for m in models):
        raise BadRequest(description="L'elenco dei modelli deve contenere stringhe non vuote.")
    models = [str(m).strip() for m in models]
    if not models:
        raise BadRequest(description="Indica almeno un modello: il primo è il predefinito.")

    return {
        'slug': slug,
        'label': label,
        'protocol': protocol,
        'base_url': base_url,
        'models': models,
        'enabled': bool(payload.get('enabled', True)),
        'is_default': bool(payload.get('is_default', False)),
        'notes': (str(payload['notes']).strip() or None) if payload.get('notes') else None,
    }


def _validate_base_url(value: str) -> str:
    """Sanity-check an administrator-supplied URL.

    This is hygiene, not a security boundary: whoever reaches this endpoint is
    a super-admin who already controls the deployment. It rejects the shapes
    that cause confusing failures or leak into logs — a missing scheme, and
    credentials embedded in the URL, which would end up in job provenance.
    """
    parsed = urlparse(value)
    if parsed.scheme not in ('http', 'https'):
        raise BadRequest(description="L'indirizzo deve iniziare con http:// o https://.")
    if not parsed.hostname:
        raise BadRequest(description="L'indirizzo non contiene un host valido.")
    if parsed.username or parsed.password:
        raise BadRequest(
            description="Non inserire credenziali nell'URL: ogni docente usa la propria chiave."
        )
    return value.rstrip('/')


def _conflict_or_raise(exc: Exception, slug: str) -> Exception:
    if 'llm_endpoints_slug_key' in str(exc):
        return Conflict(description=f"Esiste già un endpoint con slug '{slug}'.")
    return exc


def _as_params(fields: dict) -> dict:
    return {**fields, 'models': json.dumps(fields['models'])}


def _row_to_dict(row) -> dict:
    return {
        'id': row[0],
        'slug': row[1],
        'label': row[2],
        'protocol': row[3],
        'base_url': row[4],
        'models': row[5] if isinstance(row[5], list) else json.loads(row[5] or '[]'),
        'enabled': row[6],
        'is_default': row[7],
        'notes': row[8],
        'created_at': row[9].isoformat() if row[9] else None,
        'updated_at': row[10].isoformat() if row[10] else None,
    }
