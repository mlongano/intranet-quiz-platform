-- Enable UUID generation functions if you plan to use UUIDs instead of SERIAL
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------
-- Table: students
-- Purpose: Stores information about registered students. Replaces students.jsonc.
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  student_identifier TEXT NOT NULL UNIQUE, -- e.g., email address or unique username
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE students IS 'Stores information about registered students.';
COMMENT ON COLUMN students.student_identifier IS 'Unique identifier for the student (e.g., email).';

-- -----------------------------------------------------
-- Table: questions_master
-- Purpose: Stores the master set of all possible quiz questions. Replaces questions.jsonc.
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS questions_master (
  id SERIAL PRIMARY KEY,
  -- Stores the entire question object: {id, type, text, options, correct, weight, image paths, etc.}
  question_data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE questions_master IS 'Stores the master set of all possible quiz questions.';
COMMENT ON COLUMN questions_master.question_data IS 'JSONB object containing all details for a single question.';

-- Add an index to efficiently query questions by their original ID within the JSONB structure
-- Use ->> to index the value as text. Adjust if the ID is consistently numeric.
CREATE INDEX IF NOT EXISTS idx_gin_question_master_data_id ON questions_master USING GIN ((question_data ->> 'id'));

-- Optional: Trigger to update updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_questions_master_updated_at
BEFORE UPDATE ON questions_master
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------
-- Table: quiz_plans
-- Purpose: Stores the specific plan (question order, option order) for an active quiz instance. Replaces files in quizzes/.
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS quiz_plans (
  id SERIAL PRIMARY KEY,
  quiz_uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(), -- Unique identifier for this specific quiz instance
  student_identifier TEXT NOT NULL, -- Identifier of the student taking the quiz
  plan_data JSONB NOT NULL, -- JSONB array of plan steps: [{"id": question_id, "option_order": [...]}, ...]
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Optional Foreign Key: Enforces that the student exists in the students table
  CONSTRAINT fk_student
    FOREIGN KEY(student_identifier)
    REFERENCES students(student_identifier)
    ON DELETE SET NULL -- Or ON DELETE CASCADE, depending on desired behavior
    ON UPDATE CASCADE
);

COMMENT ON TABLE quiz_plans IS 'Stores the specific plan for an active quiz instance started by a student.';
COMMENT ON COLUMN quiz_plans.quiz_uuid IS 'Unique identifier for this specific quiz attempt.';
COMMENT ON COLUMN quiz_plans.student_identifier IS 'Identifier of the student taking the quiz.';
COMMENT ON COLUMN quiz_plans.plan_data IS 'JSONB array defining the order of questions and options for this quiz.';

-- Index for faster lookup by student
CREATE INDEX IF NOT EXISTS idx_quiz_plans_student_identifier ON quiz_plans(student_identifier);

-- -----------------------------------------------------
-- Table: scores
-- Purpose: Stores the results of completed quiz submissions. Replaces scores.jsonc.
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS scores (
  id SERIAL PRIMARY KEY,
  quiz_uuid UUID NOT NULL, -- References the specific quiz instance that was submitted
  student_identifier TEXT NOT NULL, -- Identifier of the student who submitted
  score_details JSONB NOT NULL, -- JSONB object containing {answers: [...], raw_points, max_points, percent}
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Optional Foreign Key: Links score back to the specific quiz plan (if needed for history)
  -- Note: quiz_plans entry might be deleted after submission, so this FK might fail or need adjustment.
  -- Consider removing this FK if plans are always deleted.
  -- CONSTRAINT fk_quiz_plan
  --   FOREIGN KEY(quiz_uuid)
  --   REFERENCES quiz_plans(quiz_uuid)
  --   ON DELETE SET NULL, -- Plan might be deleted

  -- Optional Foreign Key: Links score to the student
  CONSTRAINT fk_student
    FOREIGN KEY(student_identifier)
    REFERENCES students(student_identifier)
    ON DELETE SET NULL -- Keep score even if student is deleted? Or CASCADE?
    ON UPDATE CASCADE
);

COMMENT ON TABLE scores IS 'Stores the results of completed quiz submissions.';
COMMENT ON COLUMN scores.quiz_uuid IS 'Identifier of the quiz instance that was submitted.';
COMMENT ON COLUMN scores.student_identifier IS 'Identifier of the student who submitted.';
COMMENT ON COLUMN scores.score_details IS 'JSONB object containing detailed answers, points, and percentages.';

-- Indexes for faster lookup
CREATE INDEX IF NOT EXISTS idx_scores_quiz_uuid ON scores(quiz_uuid);
CREATE INDEX IF NOT EXISTS idx_scores_student_identifier ON scores(student_identifier);
CREATE INDEX IF NOT EXISTS idx_scores_submitted_at ON scores(submitted_at);

-- -----------------------------------------------------
-- Table: question_banks
-- Purpose: Stores saved versions of the question set. Replaces question_bank/ folder.
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS question_banks (
  id SERIAL PRIMARY KEY,
  bank_name TEXT NOT NULL UNIQUE, -- Unique name for the saved bank (e.g., '20250130_final_exam')
  questions_data JSONB NOT NULL, -- JSONB array storing the list of question objects at the time of saving
  saved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE question_banks IS 'Stores saved snapshots (versions) of the master question set.';
COMMENT ON COLUMN question_banks.bank_name IS 'Unique identifier/name for this saved version.';
COMMENT ON COLUMN question_banks.questions_data IS 'JSONB array of the question objects as they were when saved.';

-- -----------------------------------------------------
-- Table: scores_banks
-- Purpose: Stores saved versions of the scores data. Replaces scores_bank/ folder.
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS scores_banks (
  id SERIAL PRIMARY KEY,
  bank_name TEXT NOT NULL UNIQUE, -- Unique name for the saved scores bank (e.g., '20250130_final_scores')
  scores_data JSONB NOT NULL, -- JSONB array storing the list of score entries at the time of saving
  saved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE scores_banks IS 'Stores saved snapshots (versions) of the scores data.';
COMMENT ON COLUMN scores_banks.bank_name IS 'Unique identifier/name for this saved version.';
COMMENT ON COLUMN scores_banks.scores_data IS 'JSONB array of the score entries as they were when saved.';


-- -----------------------------------------------------
-- Table: images
-- Purpose: Stores image binary data and metadata.
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS images (
  id SERIAL PRIMARY KEY,
  image_key TEXT UNIQUE; -- Or UUID UNIQUE
  mime_type TEXT NOT NULL, -- e.g., 'image/jpeg', 'image/png'
  image_data BYTEA NOT NULL, -- Stores the raw binary data of the image
  original_filename TEXT NULL, -- Optional: Store the original filename
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE images IS 'Stores image binary data and metadata.';
COMMENT ON COLUMN images.image_key IS 'Unique identifier for the image. It can be the relative path to the image file.';
COMMENT ON COLUMN images.mime_type IS 'The MIME type of the image (e.g., image/jpeg).';
COMMENT ON COLUMN images.image_data IS 'The raw binary data of the image file.';
COMMENT ON COLUMN images.original_filename IS 'The original filename during upload (optional).';

CREATE INDEX IF NOT EXISTS idx_images_image_key ON images(image_key);

-- -----------------------------------------------------
-- Modified Table: questions_master
-- Purpose: Stores master questions, referencing images via ID.
-- -----------------------------------------------------
-- (Keep the existing questions_master table structure, but modify how image info is stored within question_data)
-- No SQL change needed here directly, but the JSONB content changes.

-- Example of how question_data JSONB would change:
-- Instead of:
-- { ..., "question_image": "path/to/image.jpg", "options": [{"text": "A", "image": "path/to/opt.png"}] }
-- It would become:
-- { ..., "question_image_id": 123, "options": [{"text": "A", "image_id": 456}] }
-- Where 123 and 456 are FOREIGN KEY references to the `images.id` column.
