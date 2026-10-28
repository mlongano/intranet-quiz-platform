"""Google Workspace Sync configuration behavior."""

from tests.conftest import make_teacher, teacher_token


def test_run_sync_reports_missing_config(monkeypatch):
    from auth.google_sync import run_sync

    for key in (
        'GOOGLE_SA_KEY_PATH',
        'GOOGLE_DELEGATED_SUBJECT',
        'GOOGLE_DOMAIN',
        'GOOGLE_TEACHER_GROUP',
    ):
        monkeypatch.delenv(key, raising=False)

    result = run_sync(triggered_by=None)

    assert result['errors']
    assert any('service account' in error.lower() for error in result['errors'])
    assert result['teachers_added'] == 0
    assert result['students_added'] == 0


def test_super_admin_sync_returns_error_status_for_missing_config(client, db_conn, monkeypatch):
    for key in (
        'GOOGLE_SA_KEY_PATH',
        'GOOGLE_DELEGATED_SUBJECT',
        'GOOGLE_DOMAIN',
        'GOOGLE_TEACHER_GROUP',
    ):
        monkeypatch.delenv(key, raising=False)

    teacher_id = make_teacher(
        db_conn,
        email='super-sync@test.it',
        role='super_admin',
        display_name='Super Sync',
    )
    token = teacher_token(teacher_id, role='super_admin', email='super-sync@test.it')

    response = client.post(
        '/api/super-admin/sync',
        headers={'Authorization': f'Bearer {token}'},
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body['status'] == 'error'
    assert body['result']['errors']


# ── what a sync may change ───────────────────────────────────────────────────

def _fake_directory(monkeypatch, *, teachers, users, groups, members):
    from auth import google_sync
    monkeypatch.setenv('GOOGLE_DOMAIN', 'test.it')
    monkeypatch.setenv('GOOGLE_TEACHER_GROUP', 'docenti@test.it')
    monkeypatch.setattr(google_sync, '_config_errors', lambda: [])
    monkeypatch.setattr(google_sync, '_build_service', lambda: object())

    def list_members(_svc, group):
        if group == 'docenti@test.it':
            if isinstance(teachers, Exception):
                raise teachers
            return teachers
        return members[group]

    def list_users(_svc, _domain):
        if isinstance(users, Exception):
            raise users
        return [{'primaryEmail': e, 'id': 'g-' + e, 'name': {'fullName': e}} for e in users]

    monkeypatch.setattr(google_sync, '_list_group_members', list_members)
    monkeypatch.setattr(google_sync, '_list_all_users', list_users)
    monkeypatch.setattr(google_sync, '_list_groups', lambda _svc, _d: groups)


def test_a_failed_user_listing_disables_no_one(db_conn, monkeypatch):
    from auth.google_sync import run_sync
    from tests.conftest import make_student
    sid = make_student(db_conn, email='resta@test.it')
    _fake_directory(monkeypatch, teachers=['prof@test.it'], users=RuntimeError('quota'), groups=[], members={})
    result = run_sync()
    assert result['errors']
    assert db_conn.execute("SELECT status FROM students WHERE id=%s", (sid,)).fetchone()[0] == 'active'


def test_a_failed_teacher_group_files_no_teacher_as_student(db_conn, monkeypatch):
    from auth.google_sync import run_sync
    _fake_directory(monkeypatch, teachers=RuntimeError('403'), users=['prof@test.it'], groups=[], members={})
    result = run_sync()
    assert result['errors']
    assert db_conn.execute("SELECT 1 FROM students WHERE email='prof@test.it'").fetchone() is None


def test_group_class_members_follow_the_group(db_conn, monkeypatch):
    from auth.google_sync import run_sync
    group = {'email': 'class-4ai@test.it', 'name': 'class-4AI', 'id': 'grp-4ai'}
    users = ['prof@test.it', 'a@test.it', 'b@test.it']
    _fake_directory(monkeypatch, teachers=['prof@test.it'], users=users, groups=[group],
                    members={'class-4ai@test.it': ['a@test.it', 'b@test.it']})
    run_sync()
    _fake_directory(monkeypatch, teachers=['prof@test.it'], users=users, groups=[group],
                    members={'class-4ai@test.it': ['a@test.it']})
    run_sync()
    rows = db_conn.execute(
        """SELECT s.email FROM class_students cs JOIN students s ON s.id = cs.student_id
           JOIN classes c ON c.id = cs.class_id WHERE c.google_group_id = 'grp-4ai'""").fetchall()
    assert [r[0] for r in rows] == ['a@test.it']


def test_stored_sync_runs_keep_no_temporary_password(client, db_conn, monkeypatch):
    from tests.conftest import make_teacher, teacher_token
    _fake_directory(monkeypatch, teachers=['nuovo.prof@test.it'], users=['nuovo.prof@test.it'], groups=[], members={})
    admin = make_teacher(db_conn, email='sa-sync@test.it', role='super_admin')
    auth = {'Authorization': f"Bearer {teacher_token(admin, role='super_admin', email='sa-sync@test.it')}"}
    r = client.post('/api/super-admin/sync', headers=auth).get_json()
    assert r['result']['new_teacher_credentials'][0]['temp_password']        # shown once
    stored = client.get(f"/api/super-admin/sync/{r['run_id']}", headers=auth).get_json()
    assert stored['result']['new_teacher_credentials'] == [{'email': 'nuovo.prof@test.it'}]
