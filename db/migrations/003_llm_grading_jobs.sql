CREATE TABLE llm_grading_jobs (
  id BIGSERIAL PRIMARY KEY,
  teacher_id BIGINT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  session_id BIGINT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  score_entry_id BIGINT REFERENCES score_entries(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  job_type TEXT NOT NULL
    CHECK (job_type IN ('submission', 'regrade_score', 'regrade_session')),
  total_items INTEGER NOT NULL DEFAULT 0,
  processed_items INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX idx_llm_grading_jobs_status_created
  ON llm_grading_jobs (status, created_at);

CREATE INDEX idx_llm_grading_jobs_teacher_session
  ON llm_grading_jobs (teacher_id, session_id);
