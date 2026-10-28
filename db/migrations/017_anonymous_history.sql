-- Anonymous history: before retention deletes a session, what is useful for
-- the long run (how questions performed, how answers were graded) is copied
-- here without anything that leads back to a student.
--
-- Anonymous, not pseudonymous: no student id, no per-student code, no link
-- between the answers one student gave (answers are stored shuffled per
-- question), no session date or class name — only the school year and, when
-- unambiguous, the year of course. Free text (open answers, motivations) has
-- the names and addresses the school knows replaced. Sessions with fewer than
-- HISTORY_MIN_SUBMISSIONS (5) submissions are not copied: the teacher would
-- know whose answers they are. Being anonymous, it has no expiry.

CREATE TABLE history_quizzes (
  id            BIGSERIAL PRIMARY KEY,
  -- The quiz's author, so they see their own history; it outlives them.
  teacher_id    BIGINT REFERENCES teachers(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,          -- the quiz's title, not the session's
  school_year   TEXT NOT NULL,          -- '2024-2025'
  grade         SMALLINT,               -- year of course 1-5, when unambiguous
  submissions   INTEGER NOT NULL,
  archived_at   DATE NOT NULL DEFAULT CURRENT_DATE
);
CREATE INDEX idx_history_quizzes_teacher ON history_quizzes(teacher_id, school_year);

CREATE TABLE history_questions (
  id              BIGSERIAL PRIMARY KEY,
  quiz_id         BIGINT NOT NULL REFERENCES history_quizzes(id) ON DELETE CASCADE,
  position        INTEGER NOT NULL,
  question_key    TEXT NOT NULL,        -- the question's id in the quiz
  type            TEXT NOT NULL,
  question        JSONB NOT NULL        -- text, options, correct/acceptable, weight
);
CREATE INDEX idx_history_questions_quiz ON history_questions(quiz_id);

CREATE TABLE history_answers (
  id               BIGSERIAL PRIMARY KEY,
  question_id      BIGINT NOT NULL REFERENCES history_questions(id) ON DELETE CASCADE,
  -- closed: the chosen options as original indices; open: the scrubbed text
  answer           JSONB,
  points           NUMERIC(10, 2),       -- NULL: never graded
  max_points       NUMERIC(10, 2) NOT NULL,
  motivation       TEXT,                 -- scrubbed; the teacher's, else the model's
  model_points     NUMERIC(10, 2),       -- the model's score when the teacher changed it
  teacher_reviewed BOOLEAN NOT NULL DEFAULT false,
  llm_model        TEXT,
  prompt_version   TEXT
);
CREATE INDEX idx_history_answers_question ON history_answers(question_id);
