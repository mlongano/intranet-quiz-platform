-- Migration 002: Google Classroom course mapping

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS google_classroom_course_id TEXT,
  ADD COLUMN IF NOT EXISTS classroom_owner_teacher_id BIGINT REFERENCES teachers(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_classes_classroom_course
  ON classes (google_classroom_course_id)
  WHERE google_classroom_course_id IS NOT NULL;

