"""The results-link e-mail: from the teacher's Gmail, only once published,
one per student who handed in, with the link and nothing else."""
import base64
import email

import pytest

from tests.conftest import make_session, make_snapshot, make_student, make_teacher, teacher_token


class _Gmail:
    def __init__(self, fail_for=()):
        self.sent, self.fail_for = [], set(fail_for)

    def users(self):
        return self

    def messages(self):
        return self

    def send(self, userId, body):
        msg = email.message_from_bytes(base64.urlsafe_b64decode(body['raw']))
        gmail = self

        class _Call:
            def execute(self_inner):
                if msg['To'] in gmail.fail_for:
                    raise RuntimeError('Invalid To header')
                gmail.sent.append(msg)
        assert userId == 'me'
        return _Call()


@pytest.fixture()
def w(client, db_conn, monkeypatch):
    import email_service
    teacher = make_teacher(db_conn, email='mail-teacher@test.it', display_name='Laura Bianchi')
    session = make_session(db_conn, teacher, make_snapshot(db_conn, teacher), status='closed')
    db_conn.execute("UPDATE quiz_sessions SET title='Verifica HTTP' WHERE id=%s", (session,))
    for i, status in enumerate(('active', 'active', 'disabled')):
        sid = make_student(db_conn, email=f'mail{i}@test.it')
        db_conn.execute("UPDATE students SET status=%s WHERE id=%s", (status, sid))
        db_conn.execute("""INSERT INTO score_entries (session_id, student_id, teacher_id, raw_points, max_points,
                           percent, answers) VALUES (%s,%s,%s,7,10,70,'[]'::jsonb)""", (session, sid, teacher))
    db_conn.commit()
    gmail = _Gmail()
    acting_as = []
    monkeypatch.setattr(email_service, 'gmail_service', lambda who: acting_as.append(who) or gmail)
    auth = {'Authorization': f"Bearer {teacher_token(teacher, email='mail-teacher@test.it')}"}
    return {'client': client, 'db': db_conn, 'session': session, 'auth': auth, 'gmail': gmail,
            'acting_as': acting_as, 'monkeypatch': monkeypatch}


def _send(w, headers=None):
    return w['client'].post(f"/api/teacher/sessions/{w['session']}/results/email",
                            headers={**w['auth'], 'X-Forwarded-Proto': 'https', **(headers or {})},
                            base_url='http://quiz.example.it')


def _publish(w):
    w['client'].post(f"/api/teacher/sessions/{w['session']}/results/publish", json={}, headers=w['auth'])


def test_refused_before_publication(w):
    r = _send(w)
    assert r.status_code == 409 and r.get_json()['code'] == 'RESULTS_NOT_PUBLISHED'
    assert w['gmail'].sent == []


def test_one_link_per_student_from_the_teacher(w):
    _publish(w)
    r = _send(w)
    assert r.status_code == 200 and r.get_json()['sent'] == 2          # the disabled one is left out
    assert w['acting_as'] == ['mail-teacher@test.it']
    msg = w['gmail'].sent[0]
    assert msg['From'] == 'Laura Bianchi <mail-teacher@test.it>'
    assert msg['To'] == 'mail0@test.it'
    assert msg['Subject'] == 'Risultati: Verifica HTTP'
    body = msg.get_payload(decode=True).decode()
    assert f"https://quiz.example.it/risultati/{w['session']}" in body
    assert '70' not in body and '7' not in body.replace(str(w['session']), '')   # no score


def test_public_base_url_wins(w):
    w['monkeypatch'].setenv('PUBLIC_BASE_URL', 'https://quiz.marconirovereto.it/')
    _publish(w)
    assert _send(w).get_json()['link'] == f"https://quiz.marconirovereto.it/risultati/{w['session']}"


def test_the_session_remembers_the_sending(w):
    _publish(w)
    _send(w)
    s = w['client'].get(f"/api/teacher/sessions/{w['session']}", headers=w['auth']).get_json()
    assert s['results_emailed_count'] == 2 and s['results_emailed_at']


def test_one_failure_does_not_stop_the_rest(w):
    w['gmail'].fail_for = {'mail0@test.it'}
    _publish(w)
    body = _send(w).get_json()
    assert body['sent'] == 1 and body['errors'][0]['email'] == 'mail0@test.it'


def test_missing_delegation_says_what_to_enable(w):
    import email_service

    def refuse(_who):
        raise email_service.EmailNotAvailable('EMAIL_NOT_AUTHORIZED', 'abilitare gmail.send')
    w['monkeypatch'].setattr(email_service, 'gmail_service', refuse)
    _publish(w)
    r = _send(w)
    assert r.status_code == 503 and r.get_json()['code'] == 'EMAIL_NOT_AUTHORIZED'


def test_another_teacher_cannot_send(w, db_conn):
    other = make_teacher(db_conn, email='mail-other@test.it')
    _publish(w)
    r = w['client'].post(f"/api/teacher/sessions/{w['session']}/results/email",
                         headers={'Authorization': f"Bearer {teacher_token(other, email='mail-other@test.it')}"})
    assert r.status_code == 404 and w['gmail'].sent == []
