-- Migration 008: administrator-managed LLM endpoints
--
-- The set of endpoints grading may talk to is a closed list, defined here by a
-- super-admin. Teachers will later choose from it by id (Fase 4) and never by
-- URL, which is what keeps the reachable hosts a fixed set and means there is
-- no request-forgery surface to validate against.
--
-- Until then the table also replaces LLM_BASE_URL for installations that
-- populate it: the endpoint marked is_default is used for grading, so changing
-- where grading runs no longer means editing .env and restarting.

CREATE TABLE llm_endpoints (
    id            BIGSERIAL PRIMARY KEY,
    slug          TEXT NOT NULL UNIQUE,   -- stable identifier, readable in audit trails
    label         TEXT NOT NULL,          -- what a teacher sees
    protocol      TEXT NOT NULL CHECK (protocol IN ('openai', 'anthropic', 'deepseek')),
    base_url      TEXT,                   -- NULL = the provider's own hosted endpoint
    requires_key  BOOLEAN NOT NULL DEFAULT true,
    models        JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [] = any model allowed
    enabled       BOOLEAN NOT NULL DEFAULT true,
    is_default    BOOLEAN NOT NULL DEFAULT false,
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one default, enforced by the database rather than by application
-- code: two defaults would make "which endpoint graded this?" unanswerable.
CREATE UNIQUE INDEX uq_llm_endpoints_single_default
    ON llm_endpoints ((true)) WHERE is_default;

CREATE INDEX idx_llm_endpoints_enabled ON llm_endpoints (enabled) WHERE enabled;
