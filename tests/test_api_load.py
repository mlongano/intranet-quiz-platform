from concurrent.futures import ThreadPoolExecutor


def test_quiz_info_concurrent(app_client):
    app = app_client.application

    def do_request():
        with app.test_client() as client:
            response = client.get("/api/quiz-info")
            return response.status_code, response.get_json()

    with ThreadPoolExecutor(max_workers=10) as executor:
        results = list(executor.map(lambda _: do_request(), range(30)))

    for status_code, data in results:
        assert status_code == 200
        assert data["title"] == "Test Quiz"
        assert data["question_count"] == 1


def test_start_concurrent_unique_students(app_client):
    app = app_client.application
    students = [f"student{i:03d}@example.com" for i in range(20)]

    def do_request(student_email):
        with app.test_client() as client:
            response = client.post("/api/start", json={"name": student_email})
            return student_email, response.status_code, response.get_json()

    with ThreadPoolExecutor(max_workers=10) as executor:
        results = list(executor.map(do_request, students))

    quiz_ids = set()
    for student_email, status_code, data in results:
        assert status_code == 200
        assert isinstance(data.get("quiz_id"), str)
        assert len(data["quiz_id"]) == 12
        quiz_ids.add(data["quiz_id"])

    assert len(quiz_ids) == len(students)


def test_finish_quiz_concurrent(app_client):
    app = app_client.application
    students = [f"student{i:03d}@example.com" for i in range(30)]

    def do_full_quiz(student_email):
        with app.test_client() as client:
            start_resp = client.post("/api/start", json={"name": student_email})
            if start_resp.status_code != 200:
                return (
                    student_email,
                    "start",
                    start_resp.status_code,
                    start_resp.get_json(),
                )

            quiz_id = start_resp.get_json().get("quiz_id")

            save_resp = client.post(
                "/api/save-answer",
                json={"quiz_id": quiz_id, "answer": 0},
            )
            if save_resp.status_code != 200:
                return (
                    student_email,
                    "save",
                    save_resp.status_code,
                    save_resp.get_json(),
                )

            submit_resp = client.post("/api/submit", json={"quiz_id": quiz_id})
            return (
                student_email,
                "submit",
                submit_resp.status_code,
                submit_resp.get_json(),
            )

    with ThreadPoolExecutor(max_workers=10) as executor:
        results = list(executor.map(do_full_quiz, students))

    failures = [r for r in results if r[2] != 200]
    assert failures == []

    scores_resp = app_client.post("/api/scores", json={"pw": "testpw"})
    assert scores_resp.status_code == 200
    scores = scores_resp.get_json()
    assert len(scores) == len(students)
