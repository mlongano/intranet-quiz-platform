"""Teacher-owned Google Classroom roster sync."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

from google.oauth2 import service_account
from googleapiclient.discovery import build
from werkzeug.exceptions import BadRequest

import db
from db import queries as Q

CLASSROOM_SCOPES = [
    'https://www.googleapis.com/auth/classroom.courses.readonly',
    'https://www.googleapis.com/auth/classroom.rosters.readonly',
    'https://www.googleapis.com/auth/classroom.profile.emails',
]


def _current_academic_year() -> str:
    now = datetime.now(timezone.utc)
    year = now.year
    if now.month >= 9:
        return f"{year}-{year + 1}"
    return f"{year - 1}-{year}"


def _config_errors() -> list[str]:
    errors = []
    sa_key_path = os.environ.get('GOOGLE_SA_KEY_PATH')
    if not sa_key_path:
        errors.append('Percorso del file JSON della service account mancante.')
    elif not os.path.isfile(sa_key_path):
        errors.append(f"File service account non trovato: {sa_key_path}")
    else:
        try:
            with open(sa_key_path, 'r', encoding='utf-8') as f:
                info = json.load(f)
            if 'installed' in info or 'web' in info:
                errors.append(
                    'Il file Google configurato e un client OAuth, non una service account. '
                    'Scarica una chiave JSON da IAM > Service accounts.'
                )
            missing = [
                key for key in ('type', 'client_email', 'private_key', 'token_uri')
                if not info.get(key)
            ]
            if missing:
                errors.append(
                    f"File service account non valido: campi mancanti {', '.join(missing)}."
                )
            elif info.get('type') != 'service_account':
                errors.append('File service account non valido: type deve essere "service_account".')
        except (OSError, ValueError) as e:
            errors.append(f"Impossibile leggere il file service account: {e}")
    return errors


def _build_classroom_service(teacher_email: str):
    sa_key_path = os.environ['GOOGLE_SA_KEY_PATH']
    creds = service_account.Credentials.from_service_account_file(
        sa_key_path, scopes=CLASSROOM_SCOPES
    ).with_subject(teacher_email)
    return build('classroom', 'v1', credentials=creds)


def _require_config() -> None:
    errors = _config_errors()
    if errors:
        raise BadRequest(description=' '.join(errors))


def _course_title(course: dict[str, Any]) -> str:
    name = (course.get('name') or '').strip()
    section = (course.get('section') or '').strip()
    if name and section:
        return f"{name} - {section}"
    return name or section or f"Classroom {course.get('id')}"


def list_courses_for_teacher(teacher_email: str, classroom_service=None) -> list[dict]:
    _require_config()
    svc = classroom_service or _build_classroom_service(teacher_email)
    courses: list[dict] = []
    page_token = None
    while True:
        resp = svc.courses().list(
            teacherId='me',
            courseStates=['ACTIVE'],
            pageToken=page_token,
            pageSize=100,
        ).execute()
        for course in resp.get('courses', []):
            courses.append({
                'id': course.get('id'),
                'name': course.get('name') or '',
                'section': course.get('section') or '',
                'title': _course_title(course),
                'course_state': course.get('courseState'),
            })
        page_token = resp.get('nextPageToken')
        if not page_token:
            break
    return courses


def _list_course_students(svc, course_id: str) -> list[dict]:
    students: list[dict] = []
    page_token = None
    while True:
        resp = svc.courses().students().list(
            courseId=course_id,
            pageToken=page_token,
            pageSize=100,
        ).execute()
        students.extend(resp.get('students', []))
        page_token = resp.get('nextPageToken')
        if not page_token:
            break
    return students


def sync_courses_for_teacher(
    teacher_id: int,
    teacher_email: str,
    course_ids: list[str] | None = None,
    classroom_service=None,
) -> dict:
    _require_config()
    svc = classroom_service or _build_classroom_service(teacher_email)
    academic_year = os.environ.get('ACADEMIC_YEAR', _current_academic_year())
    selected = {str(course_id) for course_id in course_ids or []}
    courses = list_courses_for_teacher(teacher_email, classroom_service=svc)
    if selected:
        courses = [course for course in courses if str(course['id']) in selected]

    result = {
        'courses_synced': 0,
        'classes_added': 0,
        'students_synced': 0,
        'errors': [],
    }

    with db.get_conn() as conn:
        for course in courses:
            course_id = str(course['id'])
            try:
                row = conn.execute(Q.UPSERT_CLASSROOM_CLASS, {
                    'name': course['title'],
                    'academic_year': academic_year,
                    'google_classroom_course_id': course_id,
                    'classroom_owner_teacher_id': teacher_id,
                }).fetchone()
                class_id = row[0]
                if row[1]:
                    result['classes_added'] += 1

                conn.execute(Q.INSERT_CLASS_TEACHER, (class_id, teacher_id))
                conn.execute("DELETE FROM class_students WHERE class_id = %s", (class_id,))

                for student in _list_course_students(svc, course_id):
                    profile = student.get('profile', {})
                    email = (profile.get('emailAddress') or '').strip().lower()
                    if not email:
                        continue
                    name = profile.get('name', {})
                    display_name = name.get('fullName') or email
                    student_row = conn.execute(Q.UPSERT_STUDENT_FROM_SYNC, {
                        'email': email,
                        'google_id': profile.get('id') or student.get('userId') or email,
                        'display_name': display_name,
                    }).fetchone()
                    conn.execute(Q.INSERT_CLASS_STUDENT, (class_id, student_row[0]))
                    result['students_synced'] += 1

                result['courses_synced'] += 1
            except Exception as e:
                result['errors'].append(f"Errore durante la sincronizzazione di {course['title']}: {e}")

        conn.commit()

    return result
