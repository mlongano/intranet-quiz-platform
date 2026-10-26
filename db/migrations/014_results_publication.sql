-- Results publication: when a closed session's results become visible to its
-- students on their results page, and whether the correct answers are shown
-- with them. NULL = not published. Reopening a session withdraws it.
ALTER TABLE quiz_sessions
    ADD COLUMN results_published_at TIMESTAMPTZ,
    ADD COLUMN results_show_correct BOOLEAN NOT NULL DEFAULT false;
