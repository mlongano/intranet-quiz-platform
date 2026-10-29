-- What happened to a session's results beyond its scores, for the
-- "Cronologia modifiche": publication, withdrawal, the link e-mail.
-- Score changes stay in score_change_sets (they can be reverted; these
-- cannot). Goes with the session (retention deletes it with the rest).
CREATE TABLE session_events (
  id          BIGSERIAL PRIMARY KEY,
  session_id  BIGINT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  teacher_id  BIGINT REFERENCES teachers(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('results_published', 'results_withdrawn', 'results_emailed')),
  details     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_session_events_session ON session_events(session_id, created_at);
