"""
Google Workspace account sync.

Uses the Admin SDK Directory API with a service account (domain-wide delegation).

Environment variables required during sync:
    GOOGLE_SA_KEY_PATH          Path to the service-account JSON key file
    GOOGLE_DELEGATED_SUBJECT    Admin email to impersonate (e.g. admin@school.it)
    GOOGLE_DOMAIN               School domain (e.g. school.it)
    GOOGLE_TEACHER_GROUP        Group whose members become teachers (e.g. docenti@school.it)
    GOOGLE_CLASS_GROUP_PREFIX   Group name prefix for classes (e.g. class-)
"""

from __future__ import annotations

import os
import secrets
import string
from datetime import datetime, timezone
from typing import TYPE_CHECKING

import bcrypt
from google.oauth2 import service_account
from googleapiclient.discovery import build

import db
from db import queries as Q

if TYPE_CHECKING:
    import psycopg

SCOPES = [
    'https://www.googleapis.com/auth/admin.directory.user.readonly',
    'https://www.googleapis.com/auth/admin.directory.group.readonly',
    'https://www.googleapis.com/auth/admin.directory.group.member.readonly',
]


def _build_service():
    sa_key_path = os.environ['GOOGLE_SA_KEY_PATH']
    delegated_subject = os.environ['GOOGLE_DELEGATED_SUBJECT']
    creds = service_account.Credentials.from_service_account_file(
        sa_key_path, scopes=SCOPES
    ).with_subject(delegated_subject)
    return build('admin', 'directory_v1', credentials=creds)


def _random_temp_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


def _list_group_members(svc, group_email: str) -> list[str]:
    """Returns list of member emails for a Google Group."""
    members: list[str] = []
    page_token = None
    while True:
        resp = svc.members().list(
            groupKey=group_email,
            pageToken=page_token,
            maxResults=500,
        ).execute()
        for m in resp.get('members', []):
            if m.get('type') == 'USER' and m.get('status') == 'ACTIVE':
                members.append(m['email'].lower())
        page_token = resp.get('nextPageToken')
        if not page_token:
            break
    return members


def _list_all_users(svc, domain: str) -> list[dict]:
    """Returns all active users in the domain."""
    users: list[dict] = []
    page_token = None
    while True:
        resp = svc.users().list(
            domain=domain,
            pageToken=page_token,
            maxResults=500,
            orderBy='email',
        ).execute()
        for u in resp.get('users', []):
            if not u.get('suspended', False):
                users.append(u)
        page_token = resp.get('nextPageToken')
        if not page_token:
            break
    return users


def _list_groups(svc, domain: str) -> list[dict]:
    """Returns all groups in the domain."""
    groups: list[dict] = []
    page_token = None
    while True:
        resp = svc.groups().list(
            domain=domain,
            pageToken=page_token,
            maxResults=200,
        ).execute()
        groups.extend(resp.get('groups', []))
        page_token = resp.get('nextPageToken')
        if not page_token:
            break
    return groups


def run_sync(triggered_by: int | None = None) -> dict:
    """
    Sync users, groups, and class memberships from Google Workspace.
    Returns a result dict: {teachers_added, teachers_updated, students_added, students_updated,
                            classes_added, new_teacher_credentials: [{email, temp_password}], errors: []}.
    """
    domain = os.environ['GOOGLE_DOMAIN']
    teacher_group = os.environ['GOOGLE_TEACHER_GROUP']
    class_prefix = os.environ.get('GOOGLE_CLASS_GROUP_PREFIX', 'class-')
    academic_year = os.environ.get('ACADEMIC_YEAR', _current_academic_year())

    result = {
        'teachers_added': 0,
        'teachers_updated': 0,
        'students_added': 0,
        'students_updated': 0,
        'classes_added': 0,
        'new_teacher_credentials': [],
        'errors': [],
    }

    svc = _build_service()
    sync_start = datetime.now(timezone.utc)

    # 1. Determine who is a teacher via the teacher group
    try:
        teacher_emails = set(_list_group_members(svc, teacher_group))
    except Exception as e:
        result['errors'].append(f"Could not fetch teacher group: {e}")
        teacher_emails = set()

    # 2. All users
    try:
        all_users = _list_all_users(svc, domain)
    except Exception as e:
        result['errors'].append(f"Could not list users: {e}")
        all_users = []

    with db.get_conn() as conn:
        # 3. Upsert teachers and students
        for user in all_users:
            email = user.get('primaryEmail', '').lower()
            google_id = user.get('id', '')
            display_name = user.get('name', {}).get('fullName', email)

            if email in teacher_emails:
                _upsert_teacher(conn, email, google_id, display_name, result)
            else:
                _upsert_student(conn, email, google_id, display_name, result)

        # 4. Disable accounts not seen in this sync
        conn.execute(Q.DISABLE_UNSYNCED_TEACHERS, (sync_start,))
        conn.execute(Q.DISABLE_UNSYNCED_STUDENTS, (sync_start,))

        # 5. Class groups
        try:
            all_groups = _list_groups(svc, domain)
        except Exception as e:
            result['errors'].append(f"Could not list groups: {e}")
            all_groups = []

        for group in all_groups:
            email_addr = group.get('email', '')
            name = group.get('name', '')
            if not name.lower().startswith(class_prefix.lower()):
                continue
            class_name = name[len(class_prefix):]
            try:
                row = conn.execute(
                    Q.UPSERT_CLASS,
                    {'name': class_name, 'academic_year': academic_year,
                     'google_group_id': group.get('id', '')},
                ).fetchone()
                class_id = row[0]
                # Track as added if this was a new insert (no simple way without checking xmax,
                # so we just count classes we process — safe for idempotency)
                result['classes_added'] += 1

                members = _list_group_members(svc, email_addr)
                for member_email in members:
                    # Attach as student or teacher to the class
                    student_row = conn.execute(
                        "SELECT id FROM students WHERE email = %s", (member_email,)
                    ).fetchone()
                    if student_row:
                        conn.execute(Q.INSERT_CLASS_STUDENT, (class_id, student_row[0]))
                    else:
                        teacher_row = conn.execute(
                            "SELECT id FROM teachers WHERE email = %s", (member_email,)
                        ).fetchone()
                        if teacher_row:
                            conn.execute(Q.INSERT_CLASS_TEACHER, (class_id, teacher_row[0]))
            except Exception as e:
                result['errors'].append(f"Error processing group '{name}': {e}")

        conn.commit()

    return result


def _upsert_teacher(
    conn: psycopg.Connection,
    email: str,
    google_id: str,
    display_name: str,
    result: dict,
) -> None:
    existing = conn.execute("SELECT id FROM teachers WHERE email = %s", (email,)).fetchone()
    if existing:
        conn.execute(
            """UPDATE teachers
               SET google_id = %s, display_name = %s, status = 'active', last_synced_at = now()
               WHERE email = %s""",
            (google_id, display_name, email),
        )
        result['teachers_updated'] += 1
    else:
        temp_pw = _random_temp_password()
        pw_hash = bcrypt.hashpw(temp_pw.encode(), bcrypt.gensalt(rounds=12)).decode()
        conn.execute(Q.INSERT_TEACHER, {
            'email': email,
            'google_id': google_id,
            'display_name': display_name,
            'role': 'teacher',
            'password_hash': pw_hash,
            'password_must_change': True,
            'status': 'active',
        })
        result['teachers_added'] += 1
        result['new_teacher_credentials'].append({'email': email, 'temp_password': temp_pw})


def _upsert_student(
    conn: psycopg.Connection,
    email: str,
    google_id: str,
    display_name: str,
    result: dict,
) -> None:
    row = conn.execute(Q.UPSERT_STUDENT_FROM_SYNC, {
        'email': email,
        'google_id': google_id,
        'display_name': display_name,
    }).fetchone()
    if row and row[1]:  # inserted = True
        result['students_added'] += 1
    else:
        result['students_updated'] += 1


def _current_academic_year() -> str:
    now = datetime.now(timezone.utc)
    year = now.year
    # Italian academic year: Sep–Aug
    if now.month >= 9:
        return f"{year}-{year + 1}"
    return f"{year - 1}-{year}"
