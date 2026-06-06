-- Migration 005: score history + regrade rate limiting
--
-- score_history: audit trail for every score change (LLM regrade, manual review,
--   recalculate).  Lightweight delta table — old→new points per answer index.
-- quiz_sessions.last_regrade_at: rate-limit guard so accidental double-clicks
--   or abuse don't flood the LLM provider.

-- ── score history ────────────────────────────────────────────────────────────

CREATE TABLE score_history (
    id              BIGSERIAL PRIMARY KEY,
    score_entry_id  BIGINT NOT NULL REFERENCES score_entries(id) ON DELETE CASCADE,
    answer_index    INT NOT NULL,              -- position inside score_entries.answers[]
    old_points      NUMERIC(10,2),             -- NULL when first evaluation
    new_points      NUMERIC(10,2) NOT NULL,
    old_percent     NUMERIC(6,2),              -- score_entries.percent before change
    new_percent     NUMERIC(6,2) NOT NULL,     -- score_entries.percent after change
    reason          TEXT NOT NULL,             -- 'regrade_llm' | 'manual_review' | 'recalculate'
    llm_provider    TEXT,
    llm_model       TEXT,
    changed_by      BIGINT NOT NULL REFERENCES teachers(id),
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_score_history_entry ON score_history(score_entry_id, changed_at DESC);

-- ── rate-limit guard ─────────────────────────────────────────────────────────

ALTER TABLE quiz_sessions ADD COLUMN last_regrade_at TIMESTAMPTZ;
