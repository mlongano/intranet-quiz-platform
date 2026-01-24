import os
import sys
from pathlib import Path
import importlib
import json

import pytest


@pytest.fixture()
def app_client(tmp_path, monkeypatch):
    monkeypatch.setenv("ADMIN_PW", "testpw")

    student_list = ["student@example.com"] + [
        f"student{i:03d}@example.com" for i in range(50)
    ]
    (tmp_path / "students.jsonc").write_text(json.dumps(student_list), encoding="utf-8")
    (tmp_path / "questions.jsonc").write_text(
        '{"title":"Test Quiz","questions":[{"id":"q1","type":"single","text":"Q1","options":["A","B"],"answer":0,"weight":1}]}',
        encoding="utf-8",
    )
    (tmp_path / "quiz_status.jsonc").write_text('{"enabled": true}', encoding="utf-8")
    (tmp_path / "scores.jsonc").write_text("[]", encoding="utf-8")
    (tmp_path / "quizzes").mkdir()

    monkeypatch.chdir(tmp_path)

    repo_root = Path(__file__).resolve().parents[1]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

    for module_name in ["utils", "routes.quiz", "routes.admin", "server"]:
        if module_name in sys.modules:
            del sys.modules[module_name]

    server = importlib.import_module("server")
    client = server.APP.test_client()
    return client
