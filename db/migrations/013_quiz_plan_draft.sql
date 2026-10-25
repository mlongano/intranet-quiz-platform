-- Draft of the open answer a student is writing for their current question.
--
-- {"index": <current_index>, "text": "...", "saved_at": "<ISO 8601>"}, or NULL.
-- The client autosaves it while the student types, so a crash, a closed
-- browser or a lost connection costs at most a few seconds of work: resume
-- hands it back. save-answer replaces it with the answer (and clears it);
-- after a manual close, submit hands in a non-empty draft of the current open
-- question rather than nothing. Only one question is ever current, so one
-- draft per plan is enough.
ALTER TABLE quiz_plans ADD COLUMN draft JSONB;
