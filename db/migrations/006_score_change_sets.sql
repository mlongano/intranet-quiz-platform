-- Migration 006: score_change_sets + redesigned score_history + answer_revision
--
-- Replaces the Phase-1 score_history (migration 005) with a two-table design
-- that supports atomic revert, per-answer revision tracking, and concurrency.

-- ── replace old schema ──────────────────────────────────────────────────────

DROP TABLE IF EXISTS score_history CASCADE;

-- ── score_change_sets ───────────────────────────────────────────────────────

CREATE TABLE score_change_sets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          BIGINT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
    reason              TEXT NOT NULL CHECK (reason IN (
                            'submission',
                            'llm_grade',
                            'llm_regrade',
                            'manual_review',
                            'recalculate',
                            'revert'
                        )),
    actor_type          TEXT NOT NULL CHECK (actor_type IN ('teacher', 'system')),
    changed_by          BIGINT REFERENCES teachers(id) ON DELETE SET NULL,
    llm_job_id          BIGINT REFERENCES llm_grading_jobs(id) ON DELETE SET NULL,
    reverted_change_id  UUID REFERENCES score_change_sets(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (actor_type = 'teacher' AND changed_by IS NOT NULL)
        OR actor_type = 'system'
    )
);
CREATE INDEX idx_score_change_sets_session
    ON score_change_sets(session_id, created_at DESC);

-- ── score_history (two-table design) ────────────────────────────────────────

CREATE TABLE score_history (
    id              BIGSERIAL PRIMARY KEY,
    change_set_id   UUID NOT NULL REFERENCES score_change_sets(id) ON DELETE CASCADE,
    score_entry_id  BIGINT NOT NULL REFERENCES score_entries(id) ON DELETE CASCADE,
    question_id     TEXT NOT NULL,
    answer_index    INT NOT NULL,
    old_revision    BIGINT NOT NULL,
    new_revision    BIGINT NOT NULL,
    old_answer      JSONB NOT NULL,
    new_answer      JSONB NOT NULL,
    old_raw_points  NUMERIC(10,2) NOT NULL,
    new_raw_points  NUMERIC(10,2) NOT NULL,
    old_percent     NUMERIC(6,2) NOT NULL,
    new_percent     NUMERIC(6,2) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((old_revision = 0 AND new_revision = 0) OR (new_revision = old_revision + 1)),
    UNIQUE (change_set_id, score_entry_id, question_id)
);
CREATE INDEX idx_score_history_entry
    ON score_history(score_entry_id, created_at DESC);
CREATE INDEX idx_score_history_change_set
    ON score_history(change_set_id);

-- ── answer_revision seeding ─────────────────────────────────────────────────
-- Add answer_revision=0 to every DetailedAnswer that lacks it.
-- Missing in read paths is treated as 0 for compatibility during rollout.

UPDATE score_entries
SET answers = (
    SELECT jsonb_agg(
        a || jsonb_build_object('answer_revision', 0)
    )
    FROM jsonb_array_elements(answers) a
    WHERE NOT a ? 'answer_revision'
)
WHERE answers::text LIKE '%"type"%'   -- has at least one answer
  AND NOT answers::text LIKE '%"answer_revision"%';

-- Ensure truly empty arrays get [] not NULL
UPDATE score_entries SET answers = '[]'::jsonb WHERE answers IS NULL;

-- ── concurrency guard: at most one active regrade per session ───────────────

CREATE UNIQUE INDEX uq_llm_active_regrade_per_session
ON llm_grading_jobs(session_id)
WHERE job_type = 'regrade_session'
  AND status IN ('pending', 'running');
