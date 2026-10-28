-- Class management: teachers create and edit their own classes, rename
-- synced ones, and archive any of them.
--
-- A class's kind follows from its origin: a Classroom course id, a Workspace
-- group id, or neither (created by a teacher, or migrated from v2.6.0).
-- Members of a synced class come from Google; the others are edited by hand.

-- A renamed synced class keeps the teacher's name across later syncs.
ALTER TABLE classes ADD COLUMN name_locked BOOLEAN NOT NULL DEFAULT false;

-- Archiving is per teacher: it hides the class from that teacher's lists and
-- from the class choice for a new session; sessions and scores are untouched.
ALTER TABLE class_teachers ADD COLUMN archived_at TIMESTAMPTZ;

-- Workspace group classes are matched by their stable group id, not by name:
-- the global (name, academic_year) uniqueness stopped two teachers from
-- creating a "3AI" each, and broke when a group was renamed.
UPDATE classes SET google_group_id = NULL WHERE google_group_id = '';
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_name_academic_year_key;
CREATE UNIQUE INDEX uq_classes_google_group
  ON classes (google_group_id)
  WHERE google_group_id IS NOT NULL;
