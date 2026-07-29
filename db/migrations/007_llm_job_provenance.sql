-- Migration 007: record how each grading job was evaluated
--
-- A score is only explainable if the provider, model and prompt that produced
-- it are known. These columns are resolved once at enqueue time and read by the
-- worker from the job row -- never from the environment or the filesystem.
-- That is what makes a queued job immune to a prompt file being edited or
-- LLM_MODEL being changed after the job was created.
--
-- All nullable: rows written before this migration, and jobs already queued,
-- stay valid and are simply reported as having unknown provenance.

ALTER TABLE llm_grading_jobs
    ADD COLUMN provider        TEXT,
    ADD COLUMN model           TEXT,
    ADD COLUMN prompt_version  TEXT,
    ADD COLUMN prompt_snapshot JSONB,   -- {system, user}: the exact texts used
    ADD COLUMN params          JSONB;   -- effective temperature, max_tokens, timeout
