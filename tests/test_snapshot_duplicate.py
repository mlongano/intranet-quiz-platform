"""Duplicating a saved quiz.

A copy must be independent of the original: editing one never changes the
other, and images are copied into the copy's own folder with the references in
the questions rewritten. Sharing the original's images would leave the copy's
image manager empty and tie the copy to a folder that belongs to another quiz.
"""

import json

import pytest

from services import images, snapshots
from tests.conftest import make_snapshot, make_teacher, teacher_token

JSONC = json.dumps({'questions': [
    {'id': 1, 'type': 'single', 'text': 'Vedi ![schema]({img})', 'options': ['a', 'b'], 'correct': 0, 'weight': 2},
    {'id': 2, 'type': 'open', 'text': 'Spiega', 'options': [], 'acceptable': 'perché', 'weight': 3},
]})


@pytest.fixture
def image_root(tmp_path, monkeypatch):
    monkeypatch.setattr(images, 'IMAGES_BASE', tmp_path)
    return tmp_path


def _quiz_with_image(db_conn, teacher_id, root):
    snap = snapshots.import_jsonc(teacher_id, JSONC.replace('{img}', 'IMG'), 'Verifica OSPF')
    sid = snap['id']
    folder = root / str(teacher_id) / str(sid)
    folder.mkdir(parents=True)
    (folder / 'rete.png').write_bytes(b'\x89PNG-data')
    content = JSONC.replace('{img}', f'/images/{teacher_id}/{sid}/rete.png')
    db_conn.execute(
        "UPDATE question_snapshots SET content = %s::jsonb, images_manifest = %s::jsonb WHERE id = %s",
        (json.dumps({'questions': json.loads(content)['questions']}),
         json.dumps([{'filename': 'rete.png', 'size': 9, 'mime': 'image/png'}]), sid),
    )
    db_conn.commit()
    return sid


def test_copy_is_a_new_independent_quiz(db_conn, image_root):
    teacher_id = make_teacher(db_conn, email='dup-t@test.it')
    source = _quiz_with_image(db_conn, teacher_id, image_root)

    copy = snapshots.duplicate_snapshot(source, teacher_id)

    assert copy['id'] != source
    assert copy['title'] == 'Verifica OSPF (copia)'
    assert copy['slug'] != snapshots.get_snapshot(source, teacher_id)['slug']
    assert copy['question_count'] == 2
    original = snapshots.get_snapshot(source, teacher_id)
    duplicate = snapshots.get_snapshot(copy['id'], teacher_id)
    for a, b in zip(original['content']['questions'], duplicate['content']['questions']):
        assert {k: v for k, v in a.items() if k != 'text'} == {k: v for k, v in b.items() if k != 'text'}


def test_images_are_copied_and_references_rewritten(db_conn, image_root):
    teacher_id = make_teacher(db_conn, email='dup-img@test.it')
    source = _quiz_with_image(db_conn, teacher_id, image_root)

    copy_id = snapshots.duplicate_snapshot(source, teacher_id)['id']

    copied = image_root / str(teacher_id) / str(copy_id) / 'rete.png'
    assert copied.read_bytes() == b'\x89PNG-data'
    text = snapshots.get_snapshot(copy_id, teacher_id)['content']['questions'][0]['text']
    assert f'/images/{teacher_id}/{copy_id}/rete.png' in text
    assert f'/images/{teacher_id}/{source}/' not in text
    assert [m['filename'] for m in snapshots.get_snapshot(copy_id, teacher_id)['images_manifest']] == ['rete.png']
    # The original is untouched.
    assert f'/images/{teacher_id}/{source}/rete.png' in \
        snapshots.get_snapshot(source, teacher_id)['content']['questions'][0]['text']


def test_quiz_without_images_duplicates_too(db_conn, image_root):
    teacher_id = make_teacher(db_conn, email='dup-plain@test.it')
    source = make_snapshot(db_conn, teacher_id, title='Semplice')

    copy = snapshots.duplicate_snapshot(source, teacher_id)

    assert copy['title'] == 'Semplice (copia)'
    assert not (image_root / str(teacher_id) / str(copy['id'])).exists()


def test_cannot_duplicate_another_teachers_quiz(client, db_conn, image_root):
    owner = make_teacher(db_conn, email='dup-owner@test.it')
    other = make_teacher(db_conn, email='dup-other@test.it')
    source = make_snapshot(db_conn, owner, title='Privato')

    response = client.post(f'/api/teacher/snapshots/{source}/duplicate',
                           headers={'Authorization': f"Bearer {teacher_token(other, email='dup-other@test.it')}"})

    assert response.status_code == 404
    assert db_conn.execute("SELECT count(*) FROM question_snapshots WHERE teacher_id = %s", (other,)).fetchone()[0] == 0


def test_api_returns_the_new_quiz(client, db_conn, image_root):
    teacher_id = make_teacher(db_conn, email='dup-api@test.it')
    source = make_snapshot(db_conn, teacher_id, title='Da copiare')

    response = client.post(f'/api/teacher/snapshots/{source}/duplicate',
                           headers={'Authorization': f"Bearer {teacher_token(teacher_id, email='dup-api@test.it')}"})

    assert response.status_code == 201
    body = response.get_json()
    assert body['title'] == 'Da copiare (copia)' and body['id'] != source
