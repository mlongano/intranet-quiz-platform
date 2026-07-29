-- Migration 010: what a regrade is allowed to touch
--
-- Both columns are read by the worker from the job row, never from runtime
-- configuration. A job queued with force_override_manual = false keeps that
-- behaviour even if the teacher changes their mind while it runs, which is the
-- second of the three layers protecting a manual evaluation (the worker's
-- per-answer check is the first, the revert restoring the flag is the third).
--
-- Existing rows default to the behaviour they already had: regrades re-graded
-- every open answer, and never touched a manual override.

ALTER TABLE llm_grading_jobs
    ADD COLUMN scope TEXT NOT NULL DEFAULT 'all'
        CHECK (scope IN ('pending_only', 'all')),
    ADD COLUMN force_override_manual BOOLEAN NOT NULL DEFAULT false;
