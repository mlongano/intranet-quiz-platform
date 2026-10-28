"""Data retention: a school year's student data is kept through 31 December
after the year ends, then deleted — with everything that copies it — while
quiz content and anything still in use stay."""
import json
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest

from tests.conftest import make_class, make_session, make_snapshot, make_student, make_teacher, teacher_token

ROME = ZoneInfo('Europe/Rome')


def at(*args):
    return datetime(*args, tzinfo=ROME)


def _purge_after(conn, ts):
    return conn.execute("SELECT quizparty_purge_after(%s)", (ts,)).fetchone()[0]


def test_kept_through_31_december_after_the_school_year(db_conn):
    assert _purge_after(db_conn, at(2026, 10, 15)) == at(2028, 1, 1)      # 2026-2027
    assert _purge_after(db_conn, at(2027, 5, 20)) == at(2028, 1, 1)
    assert _purge_after(db_conn, at(2027, 8, 31, 23, 30)) == at(2028, 1, 1)
    assert _purge_after(db_conn, at(2027, 9, 1, 0, 30)) == at(2029, 1, 1)  # 2027-2028


@pytest.fixture()
def year_2025(db_conn):
    """A closed session of school year 2025-2026, with a class of that year."""
    teacher = make_teacher(db_conn, email='ret-teacher@test.it')
    gone = make_student(db_conn, email='ret-gone@test.it')       # left the school
    stays = make_student(db_conn, email='ret-stays@test.it')
    db_conn.execute("UPDATE students SET status='disabled' WHERE id=%s", (gone,))
    cls = make_class(db_conn, name='4BI', year='2025-2026')
    snap = make_snapshot(db_conn, teacher)
    session = make_session(db_conn, teacher, snap, class_ids=[cls], status='closed')
    db_conn.execute("UPDATE quiz_sessions SET created_at=%s WHERE id=%s", (at(2025, 11, 3), session))
    for sid in (gone, stays):
        db_conn.execute(
            """INSERT INTO score_entries (session_id, student_id, teacher_id, raw_points, max_points, percent,
                                          answers, submitted_at)
               VALUES (%s, %s, %s, 1, 2, 50, '[]'::jsonb, %s)""", (session, sid, teacher, at(2025, 11, 3, 10)))
    db_conn.commit()
    return {'teacher': teacher, 'gone': gone, 'stays': stays, 'cls': cls, 'snap': snap, 'session': session}


def _exists(conn, table, id_):
    return conn.execute(f"SELECT 1 FROM {table} WHERE id=%s", (id_,)).fetchone() is not None


def test_nothing_due_before_1_january(db_conn, year_2025):
    from services import retention
    assert retention.apply(now=at(2026, 12, 31, 23, 59)) == {
        'sessions': 0, 'archives': 0, 'student_lists': 0, 'classes': 0, 'students': 0}
    assert _exists(db_conn, 'quiz_sessions', year_2025['session'])


def test_on_1_january_the_years_data_goes(db_conn, year_2025):
    from services import retention
    w = year_2025
    deleted = retention.apply(now=at(2027, 1, 1, 0, 1))
    assert deleted['sessions'] == 1
    assert not _exists(db_conn, 'quiz_sessions', w['session'])
    assert db_conn.execute("SELECT count(*) FROM score_entries WHERE session_id=%s", (w['session'],)).fetchone()[0] == 0
    assert _exists(db_conn, 'question_snapshots', w['snap'])           # the questions are the teacher's
    assert deleted['classes'] == 1 and not _exists(db_conn, 'classes', w['cls'])
    assert deleted['students'] == 1 and not _exists(db_conn, 'students', w['gone'])
    assert _exists(db_conn, 'students', w['stays'])                     # still at the school


def test_runs_record_counts_only(db_conn, year_2025):
    from services import retention
    retention.apply(now=at(2027, 1, 2))
    row = db_conn.execute("SELECT deleted FROM retention_runs ORDER BY id DESC LIMIT 1").fetchone()[0]
    assert row['sessions'] == 1
    assert 'ret-gone' not in json.dumps(row)


def test_an_active_session_or_queued_grading_is_never_touched(db_conn, year_2025):
    from services import retention
    db_conn.execute("UPDATE quiz_sessions SET status='active' WHERE id=%s", (year_2025['session'],))
    db_conn.commit()
    assert retention.apply(now=at(2027, 1, 2))['sessions'] == 0
    db_conn.execute("UPDATE quiz_sessions SET status='closed' WHERE id=%s", (year_2025['session'],))
    db_conn.execute("""INSERT INTO llm_grading_jobs (session_id, teacher_id, status, job_type)
                       VALUES (%s, %s, 'pending', 'regrade_session')""", (year_2025['session'], year_2025['teacher']))
    db_conn.commit()
    assert retention.apply(now=at(2027, 1, 2))['sessions'] == 0


def test_a_submission_in_a_later_year_moves_the_session(db_conn, year_2025):
    from services import retention
    db_conn.execute("UPDATE score_entries SET submitted_at=%s WHERE student_id=%s",
                    (at(2026, 10, 1), year_2025['stays']))
    db_conn.commit()
    assert retention.apply(now=at(2027, 1, 2))['sessions'] == 0
    assert retention.apply(now=at(2028, 1, 1, 0, 1))['sessions'] == 1


def test_an_archive_expires_with_the_session_it_copied(client, db_conn, year_2025):
    from services import retention
    w = year_2025
    auth = {'Authorization': f"Bearer {teacher_token(w['teacher'], email='ret-teacher@test.it')}"}
    r = client.post(f"/api/teacher/sessions/{w['session']}/archive", json={'title': 'copia'}, headers=auth)
    assert r.status_code in (200, 201), r.get_data(as_text=True)
    deleted = retention.apply(now=at(2027, 1, 2))
    assert deleted['archives'] == 1
    assert db_conn.execute("SELECT count(*) FROM score_archives WHERE teacher_id=%s", (w['teacher'],)).fetchone()[0] == 0


def test_report_mode_deletes_nothing(db_conn, year_2025, monkeypatch):
    from services import retention
    monkeypatch.setenv('DATA_RETENTION', 'report')
    monkeypatch.setattr(retention, '_last_check', 0.0)
    retention.tick()
    assert _exists(db_conn, 'quiz_sessions', year_2025['session'])
    rep = retention.report(now=at(2027, 1, 2))
    assert rep['mode'] == 'report' and rep['due']['sessions'] == 1


def test_the_teacher_sees_until_when_data_is_kept(client, db_conn):
    teacher = make_teacher(db_conn, email='ret-now@test.it')
    session = make_session(db_conn, teacher, make_snapshot(db_conn, teacher))
    db_conn.execute("UPDATE quiz_sessions SET created_at=%s WHERE id=%s", (at(2026, 10, 28), session))
    db_conn.commit()
    auth = {'Authorization': f"Bearer {teacher_token(teacher, email='ret-now@test.it')}"}
    s = client.get(f'/api/teacher/sessions/{session}', headers=auth).get_json()
    assert s['data_kept_until'] == '2027-12-31'


def test_the_administrator_sees_what_goes_next(client, db_conn, year_2025):
    admin = make_teacher(db_conn, email='ret-admin@test.it', role='super_admin')
    auth = {'Authorization': f"Bearer {teacher_token(admin, role='super_admin', email='ret-admin@test.it')}"}
    rep = client.get('/api/super-admin/retention', headers=auth).get_json()
    assert rep['upcoming'][0] == {'date': '2026-12-31', 'sessions': 1, 'archives': 0}
