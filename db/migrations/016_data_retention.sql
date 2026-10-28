-- Data retention (GDPR): students' data is kept while it serves its purpose,
-- the assessment of one school year, and is deleted on 1 January after that
-- year ends — i.e. kept through 31 December. The school year runs September
-- to August, in the school's time zone.

-- When data dated *ts* stops being kept: 1 January of the year after its
-- school year ends. October 2026 (2026-2027) -> 2028-01-01.
CREATE FUNCTION quizparty_purge_after(ts TIMESTAMPTZ) RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE AS $$
  SELECT make_timestamptz(
    EXTRACT(YEAR FROM ts AT TIME ZONE 'Europe/Rome')::int
      + CASE WHEN EXTRACT(MONTH FROM ts AT TIME ZONE 'Europe/Rome') >= 9 THEN 2 ELSE 1 END,
    1, 1, 0, 0, 0, 'Europe/Rome')
$$;

-- A session belongs to the school year of its latest submission (a session
-- reopened in a later year moves with it), or of its creation.
CREATE FUNCTION quizparty_session_reference(sid BIGINT) RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE AS $$
  SELECT GREATEST(qs.created_at, (SELECT max(se.submitted_at) FROM score_entries se WHERE se.session_id = qs.id))
  FROM quiz_sessions qs WHERE qs.id = sid
$$;

-- An archive copies a session's scores: it expires with the data it copied,
-- not with the day it was made.
ALTER TABLE score_archives ADD COLUMN reference_at TIMESTAMPTZ;
UPDATE score_archives a
   SET reference_at = COALESCE(quizparty_session_reference(a.source_session_id), a.archived_at);
ALTER TABLE score_archives ALTER COLUMN reference_at SET NOT NULL,
                           ALTER COLUMN reference_at SET DEFAULT now();

-- What each retention run deleted: counts only, never whose data.
CREATE TABLE retention_runs (
  id        BIGSERIAL PRIMARY KEY,
  ran_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted   JSONB NOT NULL
);
