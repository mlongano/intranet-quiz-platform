-- Migration 009: per-teacher LLM configuration and credentials
--
-- Configuration and secrets are deliberately split.
--
-- teachers.llm_config holds only non-sensitive preferences, so it can be read,
-- logged and returned by the API freely. It stores endpoint_id -- never a URL --
-- because the reachable set of endpoints must stay defined by llm_endpoints:
-- copying a URL here would let a removed or re-pointed endpoint keep working.
--
-- teacher_llm_credentials holds the API keys, encrypted at the application
-- layer with a master key that lives outside the database
-- (CREDENTIAL_ENCRYPTION_KEY). A database dump therefore does not leak keys.
-- The fingerprint is a hash prefix kept in clear so the UI can show *which*
-- key is configured without being able to reveal it.

ALTER TABLE teachers
    ADD COLUMN llm_config JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE teacher_llm_credentials (
    teacher_id      BIGINT PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE,
    ciphertext      TEXT NOT NULL,        -- Fernet token: AES-128-CBC + HMAC, versioned
    fingerprint     TEXT NOT NULL,        -- sha256(key)[:8], safe to display
    key_version     TEXT,                 -- which master key encrypted this
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
