def test_quiz_info(app_client):
    response = app_client.get("/api/quiz-info")
    assert response.status_code == 200
    data = response.get_json()
    assert data["title"] == "Test Quiz"
    assert data["question_count"] == 1


def test_start_missing_name(app_client):
    response = app_client.post("/api/start", json={})
    assert response.status_code == 400


def test_start_success(app_client):
    response = app_client.post("/api/start", json={"name": "student@example.com"})
    assert response.status_code == 200
    data = response.get_json()
    assert isinstance(data.get("quiz_id"), str)
    assert len(data["quiz_id"]) == 12


def test_admin_scores_auth(app_client):
    response = app_client.post("/api/scores", json={"pw": "wrong"})
    assert response.status_code == 403

    response = app_client.post("/api/scores", json={"pw": "testpw"})
    assert response.status_code == 200
    assert response.get_json() == []
