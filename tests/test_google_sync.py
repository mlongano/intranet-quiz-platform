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
