-- Migration 001: initial multi-tenant schema
-- Apply with: python -m db.migrate up

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── core identities ──────────────────────────────────────────────────────────

CREATE TABLE teachers (
  id                   BIGSERIAL PRIMARY KEY,
  email                CITEXT UNIQUE NOT NULL,
  google_id            TEXT UNIQUE,
  display_name         TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('teacher', 'super_admin')),
  password_hash        TEXT NOT NULL,
  password_must_change BOOLEAN NOT NULL DEFAULT TRUE,
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at        TIMESTAMPTZ,
  last_synced_at       TIMESTAMPTZ
);

CREATE TABLE students (
  id             BIGSERIAL PRIMARY KEY,
  email          CITEXT UNIQUE NOT NULL,
  google_id      TEXT UNIQUE,
  display_name   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ
);

CREATE TABLE classes (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  academic_year   TEXT NOT NULL,
  google_group_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, academic_year)
);

CREATE TABLE class_teachers (
  class_id   BIGINT REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id BIGINT REFERENCES teachers(id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, teacher_id)
);

CREATE TABLE class_students (
  class_id   BIGINT REFERENCES classes(id) ON DELETE CASCADE,
  student_id BIGINT REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, student_id)
);
CREATE INDEX idx_class_students_student ON class_students(student_id);

-- ── question content ─────────────────────────────────────────────────────────

CREATE TABLE question_snapshots (
  id              BIGSERIAL PRIMARY KEY,
  teacher_id      BIGINT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  slug            TEXT NOT NULL,
  content         JSONB NOT NULL,
  images_manifest JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (teacher_id, slug)
);
CREATE INDEX idx_snapshots_teacher_updated ON question_snapshots(teacher_id, updated_at DESC);

-- ── quiz sessions ─────────────────────────────────────────────────────────────

CREATE TABLE quiz_sessions (
  id          BIGSERIAL PRIMARY KEY,
  teacher_id  BIGINT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  snapshot_id BIGINT NOT NULL REFERENCES question_snapshots(id) ON DELETE RESTRICT,
  title       TEXT NOT NULL,
  join_code   TEXT,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  opens_at    TIMESTAMPTZ,
  closes_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most one active session may hold a given join_code:
CREATE UNIQUE INDEX uq_active_join_code ON quiz_sessions(join_code) WHERE status = 'active';
CREATE INDEX idx_sessions_teacher ON quiz_sessions(teacher_id, created_at DESC);

CREATE TABLE session_classes (
  session_id BIGINT REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  class_id   BIGINT REFERENCES classes(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, class_id)
);

-- ── per-student quiz state ────────────────────────────────────────────────────

CREATE TABLE quiz_plans (
  quiz_id      TEXT PRIMARY KEY,
  session_id   BIGINT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  student_id   BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  plan         JSONB NOT NULL,
  progression  JSONB NOT NULL DEFAULT '{"current_index": 0, "answers": {}}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (session_id, student_id)
);
CREATE INDEX idx_plans_session ON quiz_plans(session_id);

-- ── scores ────────────────────────────────────────────────────────────────────

CREATE TABLE score_entries (
  id           BIGSERIAL PRIMARY KEY,
  session_id   BIGINT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  student_id   BIGINT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  teacher_id   BIGINT NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
  raw_points   NUMERIC(10, 2) NOT NULL,
  max_points   NUMERIC(10, 2) NOT NULL,
  percent      NUMERIC(6, 2) NOT NULL,
  answers      JSONB NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, student_id)
);
CREATE INDEX idx_scores_teacher_submitted ON score_entries(teacher_id, submitted_at DESC);
CREATE INDEX idx_scores_session ON score_entries(session_id);

-- ── archives ──────────────────────────────────────────────────────────────────

CREATE TABLE score_archives (
  id                BIGSERIAL PRIMARY KEY,
  teacher_id        BIGINT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  source_session_id BIGINT REFERENCES quiz_sessions(id) ON DELETE SET NULL,
  content           JSONB NOT NULL,
  notes             TEXT,
  archived_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_archives_teacher ON score_archives(teacher_id, archived_at DESC);

CREATE TABLE student_list_snapshots (
  id         BIGSERIAL PRIMARY KEY,
  teacher_id BIGINT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  content    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── sync audit ────────────────────────────────────────────────────────────────

CREATE TABLE sync_runs (
  id           BIGSERIAL PRIMARY KEY,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  triggered_by BIGINT REFERENCES teachers(id) ON DELETE SET NULL,
  result       JSONB,
  status       TEXT NOT NULL CHECK (status IN ('running', 'success', 'error'))
);
