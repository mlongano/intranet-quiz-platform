-- Results page options and the link e-mail.
-- results_show_acceptable: an open question's acceptable answer is shown to
-- students only when the teacher chooses so (it is written for grading).
-- results_emailed_*: when the link e-mail was last sent, and to how many.
ALTER TABLE quiz_sessions
    ADD COLUMN results_show_acceptable BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN results_emailed_at TIMESTAMPTZ,
    ADD COLUMN results_emailed_count INTEGER;
