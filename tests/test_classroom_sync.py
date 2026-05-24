"""Teacher Google Classroom roster sync."""

from tests.conftest import make_teacher


class _Executable:
    def __init__(self, payload):
        self.payload = payload

    def execute(self):
        return self.payload


class _StudentsResource:
    def __init__(self, students_by_course):
        self.students_by_course = students_by_course

    def list(self, courseId, **_kwargs):
        return _Executable({'students': self.students_by_course.get(courseId, [])})


class _CoursesResource:
    def __init__(self, courses, students_by_course):
        self.courses_payload = {'courses': courses}
        self.students_resource = _StudentsResource(students_by_course)

    def list(self, **_kwargs):
        return _Executable(self.courses_payload)

    def students(self):
        return self.students_resource


class _ClassroomService:
    def __init__(self, courses, students_by_course):
        self.courses_resource = _CoursesResource(courses, students_by_course)

    def courses(self):
        return self.courses_resource


def _enable_google_config(monkeypatch, tmp_path):
    key_path = tmp_path / 'service-account.json'
    key_path.write_text(
        '{"type":"service_account","client_email":"svc@test","private_key":"secret","token_uri":"https://oauth2.googleapis.com/token"}'
    )
    monkeypatch.setenv('GOOGLE_SA_KEY_PATH', str(key_path))


def test_list_courses_for_teacher_returns_active_classroom_courses(monkeypatch, tmp_path):
    from services.classroom_sync import list_courses_for_teacher

    _enable_google_config(monkeypatch, tmp_path)
    service = _ClassroomService(
        [{'id': 'course-1', 'name': 'Sistemi', 'section': '5CI', 'courseState': 'ACTIVE'}],
        {},
    )

    courses = list_courses_for_teacher('teacher@test.it', classroom_service=service)

    assert courses == [{
        'id': 'course-1',
        'name': 'Sistemi',
        'section': '5CI',
        'title': 'Sistemi - 5CI',
        'course_state': 'ACTIVE',
    }]


def test_sync_courses_imports_roster_as_teacher_class(db_conn, monkeypatch, tmp_path):
    from services.classroom_sync import sync_courses_for_teacher

    _enable_google_config(monkeypatch, tmp_path)
    teacher_id = make_teacher(db_conn, email='teacher@classroom.test')
    service = _ClassroomService(
        [{'id': 'course-1', 'name': 'Sistemi', 'section': '5CI', 'courseState': 'ACTIVE'}],
        {
            'course-1': [
                {
                    'userId': 'student-google-1',
                    'profile': {
                        'id': 'student-google-1',
                        'emailAddress': 'student1@classroom.test',
                        'name': {'fullName': 'Student One'},
                    },
                },
                {
                    'userId': 'student-google-2',
                    'profile': {
                        'id': 'student-google-2',
                        'emailAddress': 'student2@classroom.test',
                        'name': {'fullName': 'Student Two'},
                    },
                },
            ],
        },
    )

    result = sync_courses_for_teacher(
        teacher_id,
        'teacher@classroom.test',
        classroom_service=service,
    )

    assert result['errors'] == []
    assert result['courses_synced'] == 1
    assert result['classes_added'] == 1
    assert result['students_synced'] == 2

    row = db_conn.execute(
        """SELECT c.id, c.name, c.google_classroom_course_id
           FROM classes c
           JOIN class_teachers ct ON ct.class_id = c.id
           WHERE ct.teacher_id = %s""",
        (teacher_id,),
    ).fetchone()
    assert row[1] == 'Sistemi - 5CI'
    assert row[2] == 'course-1'

    members = db_conn.execute(
        """SELECT s.email
           FROM students s
           JOIN class_students cs ON cs.student_id = s.id
           WHERE cs.class_id = %s
           ORDER BY s.email""",
        (row[0],),
    ).fetchall()
    assert [member[0] for member in members] == [
        'student1@classroom.test',
        'student2@classroom.test',
    ]
