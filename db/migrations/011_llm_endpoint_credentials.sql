-- Migration 011: API keys for administrator-managed endpoints
--
-- A managed endpoint that authenticates — a school LiteLLM gateway, say — needs
-- its own key. Before this table the only fallback was the provider-wide key
-- from .env (OPENAI_API_KEY for any OpenAI-compatible endpoint), which meant a
-- key issued for api.openai.com was sent as the bearer token to whatever host
-- an endpoint pointed at. A key belongs to one destination; this is where an
-- endpoint's is kept.
--
-- Same model as teacher_llm_credentials: encrypted at the application layer
-- with CREDENTIAL_ENCRYPTION_KEY, which is not in the database, so a dump leaks
-- nothing. Kept apart from llm_endpoints so the row the admin API serialises
-- cannot carry ciphertext by accident.

CREATE TABLE llm_endpoint_credentials (
    endpoint_id     BIGINT PRIMARY KEY REFERENCES llm_endpoints(id) ON DELETE CASCADE,
    ciphertext      TEXT NOT NULL,        -- Fernet token
    fingerprint     TEXT NOT NULL,        -- sha256(key)[:8], safe to display
    key_version     TEXT,                 -- which master key encrypted this
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
