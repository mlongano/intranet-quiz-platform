-- Migration 004: block accidental TRUNCATE on non-test databases
--
-- The production data loss incident was caused by test cleanup running against the
-- real application database. Tests still need TRUNCATE in databases whose name
-- contains "test", but production/staging databases should require an explicit
-- maintenance override before any TRUNCATE can run.

CREATE OR REPLACE FUNCTION quizparty_block_production_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_database() NOT ILIKE '%test%'
     AND COALESCE(current_setting('quizparty.allow_destructive_maintenance', true), '') <> 'on'
  THEN
    RAISE EXCEPTION
      'TRUNCATE on table %.% is blocked in database %. Set quizparty.allow_destructive_maintenance=on only for an intentional maintenance session.',
      TG_TABLE_SCHEMA, TG_TABLE_NAME, current_database()
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NULL;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'schema_migrations',
    'teachers',
    'students',
    'classes',
    'class_teachers',
    'class_students',
    'question_snapshots',
    'quiz_sessions',
    'session_classes',
    'quiz_plans',
    'score_entries',
    'score_archives',
    'student_list_snapshots',
    'sync_runs',
    'llm_grading_jobs'
  ] LOOP
    IF to_regclass('public.' || quote_ident(table_name)) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS block_production_truncate ON %I', table_name);
      EXECUTE format(
        'CREATE TRIGGER block_production_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION quizparty_block_production_truncate()',
        table_name
      );
    END IF;
  END LOOP;
END;
$$;
