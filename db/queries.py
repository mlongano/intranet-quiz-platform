"""Named SQL query constants. All parameters use %s / %(name)s style (psycopg3)."""

# ── teachers ─────────────────────────────────────────────────────────────────

GET_TEACHER_BY_EMAIL = """
    SELECT id, email, password_hash, role, status, password_must_change,
           display_name, last_login_at
    FROM teachers
    WHERE email = %s
"""

GET_TEACHER_BY_ID = """
    SELECT id, email, role, status, display_name, password_must_change
    FROM teachers
    WHERE id = %s
"""

INSERT_TEACHER = """
    INSERT INTO teachers (email, google_id, display_name, role, password_hash, password_must_change, status)
    VALUES (%(email)s, %(google_id)s, %(display_name)s, %(role)s, %(password_hash)s, %(password_must_change)s, %(status)s)
    RETURNING id
"""

UPSERT_TEACHER_FROM_SYNC = """
    INSERT INTO teachers (email, google_id, display_name, role, password_hash,
                          password_must_change, status, last_synced_at)
    VALUES (%(email)s, %(google_id)s, %(display_name)s, %(role)s, %(password_hash)s,
            %(password_must_change)s, 'active', now())
    ON CONFLICT (email) DO UPDATE
        SET google_id            = EXCLUDED.google_id,
            display_name         = EXCLUDED.display_name,
            status               = 'active',
            last_synced_at       = now()
    RETURNING id, (xmax = 0) AS inserted
"""

UPDATE_TEACHER_LAST_LOGIN = """
    UPDATE teachers SET last_login_at = now() WHERE id = %s
"""

UPDATE_TEACHER_PASSWORD = """
    UPDATE teachers
    SET password_hash = %s, password_must_change = FALSE
    WHERE id = %s
"""

DISABLE_UNSYNCED_TEACHERS = """
    UPDATE teachers
    SET status = 'disabled'
    WHERE last_synced_at < %s AND role != 'super_admin' AND status = 'active'
"""

LIST_TEACHERS = """
    SELECT id, email, display_name, role, status, created_at, last_login_at, last_synced_at
    FROM teachers
    ORDER BY display_name
"""

# ── students ──────────────────────────────────────────────────────────────────

GET_STUDENT_BY_EMAIL = """
    SELECT id, email, display_name, status
    FROM students
    WHERE email = %s
"""

GET_STUDENT_BY_ID = """
    SELECT id, email, display_name, status
    FROM students
    WHERE id = %s
"""

UPSERT_STUDENT_FROM_SYNC = """
    INSERT INTO students (email, google_id, display_name, status, last_synced_at)
    VALUES (%(email)s, %(google_id)s, %(display_name)s, 'active', now())
    ON CONFLICT (email) DO UPDATE
        SET google_id      = EXCLUDED.google_id,
            display_name   = EXCLUDED.display_name,
            status         = 'active',
            last_synced_at = now()
    RETURNING id, (xmax = 0) AS inserted
"""

DISABLE_UNSYNCED_STUDENTS = """
    UPDATE students
    SET status = 'disabled'
    WHERE last_synced_at < %s AND status = 'active'
"""

LIST_STUDENTS_FOR_TEACHER = """
    SELECT DISTINCT s.id, s.email, s.display_name, s.status
    FROM students s
    JOIN class_students cs ON cs.student_id = s.id
    JOIN class_teachers ct ON ct.class_id = cs.class_id
    WHERE ct.teacher_id = %s
    ORDER BY s.display_name
"""

LIST_STUDENTS_FOR_CLASS = """
    SELECT s.id, s.email, s.display_name, s.status
    FROM students s
    JOIN class_students cs ON cs.student_id = s.id
    WHERE cs.class_id = %s
    ORDER BY s.display_name
"""

# ── classes ───────────────────────────────────────────────────────────────────

LIST_CLASSES_FOR_TEACHER = """
    SELECT c.id, c.name, c.academic_year,
           COUNT(cs.student_id) AS student_count
    FROM classes c
    JOIN class_teachers ct ON ct.class_id = c.id
    LEFT JOIN class_students cs ON cs.class_id = c.id
    WHERE ct.teacher_id = %s
    GROUP BY c.id, c.name, c.academic_year
    ORDER BY c.name
"""

UPSERT_CLASS = """
    INSERT INTO classes (name, academic_year, google_group_id)
    VALUES (%(name)s, %(academic_year)s, %(google_group_id)s)
    ON CONFLICT (name, academic_year) DO UPDATE
        SET google_group_id = EXCLUDED.google_group_id
    RETURNING id, (xmax = 0) AS inserted
"""

UPSERT_CLASSROOM_CLASS = """
    INSERT INTO classes (
        name,
        academic_year,
        google_classroom_course_id,
        classroom_owner_teacher_id
    )
    VALUES (
        %(name)s,
        %(academic_year)s,
        %(google_classroom_course_id)s,
        %(classroom_owner_teacher_id)s
    )
    ON CONFLICT (google_classroom_course_id)
        WHERE google_classroom_course_id IS NOT NULL
    DO UPDATE
        SET name = EXCLUDED.name,
            academic_year = EXCLUDED.academic_year,
            classroom_owner_teacher_id = EXCLUDED.classroom_owner_teacher_id
    RETURNING id, (xmax = 0) AS inserted
"""

INSERT_CLASS_TEACHER = """
    INSERT INTO class_teachers (class_id, teacher_id)
    VALUES (%s, %s)
    ON CONFLICT DO NOTHING
"""

INSERT_CLASS_STUDENT = """
    INSERT INTO class_students (class_id, student_id)
    VALUES (%s, %s)
    ON CONFLICT DO NOTHING
"""

# ── question snapshots ────────────────────────────────────────────────────────

LIST_SNAPSHOTS = """
    SELECT id, title, slug,
           jsonb_array_length(content->'questions') AS question_count,
           COALESCE(
               (SELECT COUNT(*) FROM jsonb_array_elements(content->'questions') AS q
                WHERE q->>'type' = 'single'), 0
           ) AS single_count,
           COALESCE(
               (SELECT COUNT(*) FROM jsonb_array_elements(content->'questions') AS q
                WHERE q->>'type' = 'multiple'), 0
           ) AS multiple_count,
           COALESCE(
               (SELECT COUNT(*) FROM jsonb_array_elements(content->'questions') AS q
                WHERE q->>'type' = 'open'), 0
           ) AS open_count,
           updated_at, created_at
    FROM question_snapshots
    WHERE teacher_id = %s
    ORDER BY created_at DESC
"""

GET_SNAPSHOT = """
    SELECT id, teacher_id, title, slug, content, images_manifest, created_at, updated_at
    FROM question_snapshots
    WHERE id = %s AND teacher_id = %s
"""

GET_SNAPSHOT_CONTENT = """
    SELECT content FROM question_snapshots WHERE id = %s
"""

INSERT_SNAPSHOT = """
    INSERT INTO question_snapshots (teacher_id, title, slug, content)
    VALUES (%(teacher_id)s, %(title)s, %(slug)s, %(content)s)
    RETURNING id, created_at, updated_at
"""

UPDATE_SNAPSHOT = """
    UPDATE question_snapshots
    SET title = %(title)s, slug = %(slug)s, content = %(content)s, updated_at = now()
    WHERE id = %(id)s AND teacher_id = %(teacher_id)s
"""

UPDATE_SNAPSHOT_IMAGES_MANIFEST = """
    UPDATE question_snapshots
    SET images_manifest = %s
    WHERE id = %s AND teacher_id = %s
"""

UPDATE_SNAPSHOT_TITLE_ONLY = """
    UPDATE question_snapshots
    SET title = %(title)s, slug = %(slug)s, updated_at = now()
    WHERE id = %(id)s AND teacher_id = %(teacher_id)s
"""

DELETE_SNAPSHOT = """
    DELETE FROM question_snapshots
    WHERE id = %s AND teacher_id = %s
"""

# ── quiz sessions ─────────────────────────────────────────────────────────────

INSERT_SESSION = """
    INSERT INTO quiz_sessions (teacher_id, snapshot_id, title, opens_at, closes_at)
    VALUES (%(teacher_id)s, %(snapshot_id)s, %(title)s, %(opens_at)s, %(closes_at)s)
    RETURNING id, created_at
"""

GET_SESSION = """
    SELECT qs.id, qs.teacher_id, qs.snapshot_id, qs.title,
           qs.join_code, qs.status, qs.opens_at, qs.closes_at, qs.created_at,
           COALESCE(
               json_agg(json_build_object('id', c.id, 'name', c.name))
               FILTER (WHERE c.id IS NOT NULL), '[]'
           ) AS classes
    FROM quiz_sessions qs
    LEFT JOIN session_classes sc ON sc.session_id = qs.id
    LEFT JOIN classes c ON c.id = sc.class_id
    WHERE qs.id = %s AND qs.teacher_id = %s
    GROUP BY qs.id
"""

LIST_SESSIONS_FOR_TEACHER = """
    SELECT qs.id, qs.title, qs.status, qs.join_code,
           qs.opens_at, qs.closes_at, qs.created_at,
           COALESCE(
               json_agg(json_build_object('id', c.id, 'name', c.name))
               FILTER (WHERE c.id IS NOT NULL), '[]'
           ) AS classes,
           COUNT(DISTINCT se.id) AS score_count
    FROM quiz_sessions qs
    LEFT JOIN session_classes sc ON sc.session_id = qs.id
    LEFT JOIN classes c ON c.id = sc.class_id
    LEFT JOIN score_entries se ON se.session_id = qs.id
    WHERE qs.teacher_id = %s
    GROUP BY qs.id
    ORDER BY qs.created_at DESC
"""

ACTIVATE_SESSION = """
    UPDATE quiz_sessions
    SET status = 'active', join_code = %s
    WHERE id = %s AND teacher_id = %s AND status = 'draft'
    RETURNING id
"""

CLOSE_SESSION = """
    UPDATE quiz_sessions
    SET status = 'closed', join_code = NULL
    WHERE id = %s AND teacher_id = %s AND status = 'active'
    RETURNING id
"""

UPDATE_JOIN_CODE = """
    UPDATE quiz_sessions
    SET join_code = %s
    WHERE id = %s AND teacher_id = %s AND status = 'active'
    RETURNING id
"""

DELETE_SESSION = """
    DELETE FROM quiz_sessions
    WHERE id = %s AND teacher_id = %s AND status = 'draft'
"""

GET_ACTIVE_SESSION_BY_CODE = """
    SELECT id, teacher_id, snapshot_id, title, join_code, status, opens_at, closes_at
    FROM quiz_sessions
    WHERE join_code = %s
      AND status = 'active'
      AND (opens_at IS NULL OR opens_at <= now())
      AND (closes_at IS NULL OR closes_at > now())
"""

INSERT_SESSION_CLASS = """
    INSERT INTO session_classes (session_id, class_id) VALUES (%s, %s)
    ON CONFLICT DO NOTHING
"""

CHECK_STUDENT_IN_SESSION = """
    SELECT 1
    FROM session_classes sc
    JOIN class_students cs ON cs.class_id = sc.class_id
    WHERE sc.session_id = %s AND cs.student_id = %s
"""

# ── quiz plans ────────────────────────────────────────────────────────────────

GET_PLAN_BY_QUIZ_ID = """
    SELECT quiz_id, session_id, student_id, plan, progression, created_at, last_updated, completed_at
    FROM quiz_plans
    WHERE quiz_id = %s
"""

GET_PLAN_BY_STUDENT_SESSION = """
    SELECT quiz_id, session_id, student_id, plan, progression, created_at, last_updated, completed_at
    FROM quiz_plans
    WHERE session_id = %s AND student_id = %s
"""

INSERT_PLAN = """
    INSERT INTO quiz_plans (quiz_id, session_id, student_id, plan, progression)
    VALUES (%(quiz_id)s, %(session_id)s, %(student_id)s, %(plan)s, %(progression)s)
    ON CONFLICT (session_id, student_id) DO NOTHING
    RETURNING quiz_id
"""

UPDATE_PLAN_PROGRESSION = """
    UPDATE quiz_plans
    SET progression = %(progression)s, last_updated = now()
    WHERE quiz_id = %(quiz_id)s
"""

MARK_PLAN_COMPLETE = """
    UPDATE quiz_plans
    SET completed_at = now(), last_updated = now()
    WHERE quiz_id = %s
"""

DELETE_PLAN = """
    DELETE FROM quiz_plans WHERE quiz_id = %s
"""

# ── score entries ─────────────────────────────────────────────────────────────

INSERT_SCORE_ENTRY = """
    INSERT INTO score_entries
        (session_id, student_id, teacher_id, raw_points, max_points, percent, answers)
    VALUES
        (%(session_id)s, %(student_id)s, %(teacher_id)s,
         %(raw_points)s, %(max_points)s, %(percent)s, %(answers)s)
    ON CONFLICT (session_id, student_id) DO NOTHING
    RETURNING id
"""

CHECK_SCORE_EXISTS = """
    SELECT 1 FROM score_entries
    WHERE session_id = %s AND student_id = %s
"""

LIST_SCORES_FOR_SESSION = """
    SELECT se.id, se.raw_points, se.max_points, se.percent,
           se.answers, se.submitted_at,
           s.email AS student_email, s.display_name AS student_name
    FROM score_entries se
    JOIN students s ON s.id = se.student_id
    WHERE se.session_id = %s
    ORDER BY se.submitted_at DESC
"""

LIST_SCORES_FOR_TEACHER = """
    SELECT se.id, se.session_id, se.raw_points, se.max_points, se.percent,
           se.answers, se.submitted_at,
           s.email AS student_email, s.display_name AS student_name,
           qs.title AS session_title
    FROM score_entries se
    JOIN students s ON s.id = se.student_id
    JOIN quiz_sessions qs ON qs.id = se.session_id
    WHERE se.teacher_id = %s
    ORDER BY se.submitted_at DESC
"""

UPDATE_SCORE_ANSWERS = """
    UPDATE score_entries
    SET answers = %(answers)s,
        raw_points = %(raw_points)s,
        max_points = %(max_points)s,
        percent = %(percent)s
    WHERE id = %(id)s AND session_id IN (
        SELECT id FROM quiz_sessions WHERE teacher_id = %(teacher_id)s
    )
"""

# ── score archives ────────────────────────────────────────────────────────────

INSERT_ARCHIVE = """
    INSERT INTO score_archives (teacher_id, title, source_session_id, content, notes)
    VALUES (%(teacher_id)s, %(title)s, %(source_session_id)s, %(content)s, %(notes)s)
    RETURNING id, archived_at
"""

LIST_ARCHIVES = """
    SELECT id, title, source_session_id, notes, archived_at
    FROM score_archives
    WHERE teacher_id = %s
    ORDER BY archived_at DESC
"""

GET_ARCHIVE = """
    SELECT id, teacher_id, title, source_session_id, content, notes, archived_at
    FROM score_archives
    WHERE id = %s AND teacher_id = %s
"""

DELETE_ARCHIVE = """
    DELETE FROM score_archives WHERE id = %s AND teacher_id = %s
"""

UPDATE_ARCHIVE_TITLE = """
    UPDATE score_archives SET title = %s WHERE id = %s AND teacher_id = %s
"""

# ── student list snapshots ────────────────────────────────────────────────────

INSERT_STUDENT_SNAPSHOT = """
    INSERT INTO student_list_snapshots (teacher_id, title, content)
    VALUES (%(teacher_id)s, %(title)s, %(content)s)
    RETURNING id, created_at
"""

LIST_STUDENT_SNAPSHOTS = """
    SELECT id, title, created_at
    FROM student_list_snapshots
    WHERE teacher_id = %s
    ORDER BY created_at DESC
"""

GET_STUDENT_SNAPSHOT = """
    SELECT id, title, content, created_at
    FROM student_list_snapshots
    WHERE id = %s AND teacher_id = %s
"""

DELETE_STUDENT_SNAPSHOT = """
    DELETE FROM student_list_snapshots WHERE id = %s AND teacher_id = %s
"""

# ── sync runs ─────────────────────────────────────────────────────────────────

INSERT_SYNC_RUN = """
    INSERT INTO sync_runs (triggered_by, status)
    VALUES (%s, 'running')
    RETURNING id
"""

FINISH_SYNC_RUN = """
    UPDATE sync_runs
    SET finished_at = now(), status = %(status)s, result = %(result)s
    WHERE id = %(id)s
"""

GET_SYNC_RUN = """
    SELECT id, started_at, finished_at, triggered_by, result, status
    FROM sync_runs
    WHERE id = %s
"""
