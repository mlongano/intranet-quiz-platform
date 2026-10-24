-- Migration 012: grading access is a teacher's own key, bound to one endpoint
--
-- The access model is now:
--   - a super-admin decides WHERE grading may go: the llm_endpoints allowlist,
--     and nothing else — no shared keys;
--   - a teacher grades only with their OWN key, stored per endpoint.
-- There is no fallback key anywhere: not per endpoint, not from .env. A
-- teacher without a key for their endpoint gets answers left pending, to be
-- graded by hand or regraded once a key is set.
--
-- Binding the key to an endpoint is what keeps it at its destination: a
-- LiteLLM key issued for the school server can never be sent to another host,
-- even after the default endpoint changes or a second one is whitelisted.

-- Shared endpoint keys (migration 011) are gone with the shared-key model.
-- None was ever stored.
DROP TABLE llm_endpoint_credentials;

-- Every endpoint authenticates with the teacher's key, so "requires a key" is
-- no longer an option: an endpoint that needs none would let anyone grade
-- without being attributable.
ALTER TABLE llm_endpoints DROP COLUMN requires_key;

ALTER TABLE teacher_llm_credentials
    ADD COLUMN endpoint_id BIGINT REFERENCES llm_endpoints(id) ON DELETE CASCADE;

-- An existing key was saved without a destination. The only one it can be
-- attributed to safely is the endpoint that teacher had selected; a key with
-- no such selection cannot be bound without guessing, so it is dropped and
-- the teacher enters it again.
UPDATE teacher_llm_credentials c
SET endpoint_id = e.id
FROM teachers t
JOIN llm_endpoints e ON e.id = NULLIF(t.llm_config->>'endpoint_id', '')::bigint
WHERE t.id = c.teacher_id;

DELETE FROM teacher_llm_credentials WHERE endpoint_id IS NULL;

ALTER TABLE teacher_llm_credentials ALTER COLUMN endpoint_id SET NOT NULL;
ALTER TABLE teacher_llm_credentials DROP CONSTRAINT teacher_llm_credentials_pkey;
ALTER TABLE teacher_llm_credentials ADD PRIMARY KEY (teacher_id, endpoint_id);
