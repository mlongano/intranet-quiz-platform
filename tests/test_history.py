"""Anonymous history: before a session's data is deleted, what serves the
long run is copied so that it leads back to no one."""
import json
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from tests.conftest import make_class, make_session, make_snapshot, make_student, make_teacher, teacher_token

ROME = ZoneInfo('Europe/Rome')
Q_SINGLE = {'id': 'q1', 'type': 'single', 'text': 'Porta di HTTP?', 'options': ['21', '80', '443'],
            'correct': 1, 'weight': 1}
Q_OPEN = {'id': 'q2', 'type': 'open', 'text': 'Spiega PATCH.', 'acceptable': 'Aggiorna solo i campi inviati.',
          'weight': 2}
NAMES = ['Mario Rossi', 'Giulia Porta', 'Luca Bianchi', 'Anna Verdi', 'Paolo Neri', 'Sara Gallo']


@pytest.fixture()
def expired(db_conn):
    teacher = make_teacher(db_conn, email='hist-teacher@test.it', display_name='Laura Docente')
    cls = make_class(db_conn, name='4BI', year='2024-2025')
    db_conn.execute("INSERT INTO class_teachers (class_id, teacher_id) VALUES (%s, %s)", (cls, teacher))
    snap = make_snapshot(db_conn, teacher, title='Verifica HTTP')
    session = make_session(db_conn, teacher, snap, class_ids=[cls], status='closed')
    db_conn.execute("UPDATE quiz_sessions SET title='4BI 23 maggio', created_at=%s WHERE id=%s",
                    (datetime(2025, 5, 23, tzinfo=ROME), session))
    students = []
    for i, name in enumerate(NAMES):
        sid = make_student(db_conn, email=f'hist{i}@test.it', display_name=name)
        students.append(sid)
        db_conn.execute("INSERT INTO class_students (class_id, student_id) VALUES (%s, %s)", (cls, sid))
        open_text = {
            0: 'Come ha detto Giulia, PATCH aggiorna solo i campi. Scrivetemi a mario.rossi@scuola.it',
            1: 'Mario Rossi dice che PATCH cambia una parte; la porta 80 non c\'entra.',
        }.get(i, 'PATCH aggiorna una parte della risorsa.')
        answers = [
            {'question_id': 'q1', 'type': 'single', 'question_snapshot': Q_SINGLE, 'option_order': [2, 1, 0],
             'raw_student_answer': 1, 'points_awarded': 1, 'weight': 1, 'llm_status': 'not_applicable'},
            {'question_id': 'q2', 'type': 'open', 'question_snapshot': Q_OPEN, 'raw_student_answer': open_text,
             'points_awarded': 1.5, 'weight': 2, 'llm_status': 'graded', 'llm_model': 'qwen3',
             'prompt_version': 'v3', 'llm_feedback': f'Bene {name.split()[0]}, manca «solo i campi inviati».',
             **({'manual_override': True, 'original_points_awarded': 1.0} if i == 2 else {})},
        ]
        db_conn.execute(
            """INSERT INTO score_entries (session_id, student_id, teacher_id, raw_points, max_points, percent,
                                          answers, submitted_at) VALUES (%s,%s,%s,2.5,3,83,%s,%s)""",
            (session, sid, teacher, json.dumps(answers), datetime(2025, 5, 23, 10, tzinfo=ROME)))
    db_conn.commit()
    return {'teacher': teacher, 'session': session, 'students': students,
            'auth': {'Authorization': f"Bearer {teacher_token(teacher, email='hist-teacher@test.it')}"}}


def _apply(now=datetime(2026, 1, 2, tzinfo=ROME)):
    from services import retention
    return retention.apply(now=now)


def test_retention_copies_then_deletes(db_conn, expired):
    deleted = _apply()
    assert deleted['sessions'] == 1 and deleted['history'] == 1
    h = db_conn.execute("SELECT title, school_year, grade, submissions FROM history_quizzes").fetchone()
    assert h == ('Verifica HTTP', '2024-2025', 4, 6)            # the quiz's title, not '4BI 23 maggio'
    assert db_conn.execute("SELECT count(*) FROM history_answers").fetchone()[0] == 12


def test_nothing_leads_back_to_a_student(db_conn, expired):
    _apply()
    dump = json.dumps([list(map(str, r)) for r in db_conn.execute(
        """SELECT a.answer, a.motivation, q.question, h.title FROM history_answers a
           JOIN history_questions q ON q.id = a.question_id JOIN history_quizzes h ON h.id = q.quiz_id""").fetchall()])
    for name in NAMES:
        for part in name.split():
            assert part not in dump, part
    assert '@' not in dump
    assert '4BI' not in dump and '23 maggio' not in dump
    assert 'la porta 80' in dump                           # a lowercase common word survives
    cols = {r[0] for r in db_conn.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name LIKE 'history_%'").fetchall()}
    assert not cols & {'student_id', 'email', 'submitted_at', 'session_id'}


def test_closed_answers_in_the_quizs_own_order(db_conn, expired):
    _apply()
    rows = db_conn.execute(
        """SELECT a.answer FROM history_answers a JOIN history_questions q ON q.id = a.question_id
           WHERE q.type = 'single'""").fetchall()
    assert {r[0] for r in rows} == {1}                     # shown [2,1,0], clicked 1 -> option 1 ('80')


def test_teacher_review_kept_as_a_label(db_conn, expired):
    _apply()
    row = db_conn.execute("SELECT points, model_points FROM history_answers WHERE teacher_reviewed").fetchone()
    assert (float(row[0]), float(row[1])) == (1.5, 1.0)


def test_a_small_session_is_not_copied(db_conn, expired):
    db_conn.execute("DELETE FROM score_entries WHERE student_id = ANY(%s)", (expired['students'][:2],))
    db_conn.commit()
    deleted = _apply()
    assert deleted['sessions'] == 1 and deleted['history'] == 0


def test_the_teacher_reads_and_exports_their_history(client, db_conn, expired):
    _apply()
    items = client.get('/api/teacher/history', headers=expired['auth']).get_json()
    assert items[0]['title'] == 'Verifica HTTP' and items[0]['questions'] == 2
    hid = items[0]['id']
    d = client.get(f'/api/teacher/history/{hid}', headers=expired['auth']).get_json()
    q1 = d['questions'][0]
    assert q1['option_counts'] == [0, 6, 0] and q1['full_marks'] == 6
    assert 'rows' not in q1
    full = client.get(f'/api/teacher/history/{hid}?answers=1', headers=expired['auth']).get_json()
    assert len(full['questions'][1]['rows']) == 6
    other = make_teacher(db_conn, email='hist-other@test.it')
    oauth = {'Authorization': f"Bearer {teacher_token(other, email='hist-other@test.it')}"}
    assert client.get(f'/api/teacher/history/{hid}', headers=oauth).status_code == 404
    assert client.delete(f'/api/teacher/history/{hid}', headers=expired['auth']).status_code == 200
