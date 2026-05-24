import json
import multiprocessing as mp
import os
import random
import re
import time
from pathlib import Path

import llm

BASE_DIR = Path(__file__).resolve().parent
PROMPT_DIR = BASE_DIR / 'prompts'
DEFAULT_SYSTEM_PROMPT_PATH = PROMPT_DIR / 'open-question-system.md'
DEFAULT_USER_PROMPT_PATH = PROMPT_DIR / 'open-question-user.md'


def evaluate_open_question(question_text, user_answer, correct_answers):
    """
    Evaluate an open question using the configured LLM model.
    Args:
        question_text (str): The question being asked.
        user_answer (str): The answer provided by the user.
        correct_answers (list[str]): List of acceptable/correct answers.
    Returns:
        dict: { 'score': float, 'verdict': str, 'llm_feedback': str }
    """
    model_id = os.getenv("LLM_MODEL", "gpt-4o-mini")
    retries = int(os.getenv("LLM_RETRIES", "0"))
    backoff = float(os.getenv("LLM_BACKOFF_FACTOR", "0.5"))
    timeout_seconds = float(os.getenv("LLM_TIMEOUT_SECONDS", "25"))

    try:
        model = llm.get_model(model_id)
    except Exception as e:
        raise RuntimeError(
            f"Cannot load model '{model_id}': {e}. "
            f"Make sure the llm plugin for this provider is installed "
            f"(e.g. 'uv add llm-anthropic' or 'uv add llm-ollama')."
        )

    system_prompt = _load_system_prompt()
    prompt = _build_prompt(question_text, user_answer, correct_answers)

    attempt = 0
    last_exc = None
    while attempt <= retries:
        try:
            response_text = _prompt_with_timeout(model_id, prompt, system_prompt, timeout_seconds)
            return _parse_llm_response(response_text)
        except Exception as e:
            last_exc = e
            sleep_time = backoff * (2 ** attempt) + random.uniform(0, 0.1)
            time.sleep(sleep_time)
            attempt += 1

    raise RuntimeError(f"LLM request failed after {retries + 1} attempts: {last_exc}")


def _prompt_with_timeout(
    model_id: str,
    prompt: str,
    system_prompt: str,
    timeout_seconds: float,
) -> str:
    queue: mp.Queue = mp.Queue(maxsize=1)
    process = mp.Process(
        target=_prompt_worker,
        args=(queue, model_id, prompt, system_prompt),
    )
    process.start()
    process.join(timeout_seconds)

    if process.is_alive():
        process.terminate()
        process.join(2)
        raise TimeoutError(f"LLM call timed out after {timeout_seconds:g} seconds")

    if queue.empty():
        raise RuntimeError("LLM call ended without a response")

    payload = queue.get()
    if payload.get('ok'):
        return payload.get('text') or ''
    raise RuntimeError(payload.get('error') or 'LLM call failed')


def _prompt_worker(queue: mp.Queue, model_id: str, prompt: str, system_prompt: str) -> None:
    try:
        model = llm.get_model(model_id)
        response = model.prompt(prompt, system=system_prompt)
        queue.put({'ok': True, 'text': response.text()})
    except Exception as e:
        queue.put({'ok': False, 'error': str(e)})


def _load_system_prompt() -> str:
    return _read_prompt_path(
        os.getenv('LLM_OPEN_QUESTION_SYSTEM_PROMPT_PATH'),
        DEFAULT_SYSTEM_PROMPT_PATH,
    )


def _load_user_prompt_template() -> str:
    return _read_prompt_path(
        os.getenv('LLM_OPEN_QUESTION_USER_PROMPT_PATH'),
        DEFAULT_USER_PROMPT_PATH,
    )


def _read_prompt_path(env_path: str | None, default_path: Path) -> str:
    path = Path(env_path).expanduser() if env_path else default_path
    if not path.is_absolute():
        path = BASE_DIR / path
    return path.read_text(encoding='utf-8')


def _build_prompt(question_text, user_answer, correct_answers):
    acceptable_answer = _format_acceptable_answer(correct_answers)
    template = _load_user_prompt_template()
    return (
        template
        .replace('{{QUESTION}}', str(question_text or '').strip())
        .replace('{{ACCEPTABLE_ANSWER}}', acceptable_answer)
        .replace('{{STUDENT_ANSWER}}', str(user_answer or '').strip())
    )


def _format_acceptable_answer(correct_answers) -> str:
    if correct_answers is None:
        return ''
    if isinstance(correct_answers, str):
        return correct_answers.strip()
    if isinstance(correct_answers, (list, tuple)):
        return '\n'.join(f"- {str(answer).strip()}" for answer in correct_answers)
    return str(correct_answers).strip()


def _parse_llm_response(response_text):
    if response_text is None:
        return _fallback_result("empty", "No response text from model.")
    if not isinstance(response_text, str):
        response_text = str(response_text)

    parsed = _parse_json_object(response_text)
    if parsed is None:
        return _fallback_result("unparseable", response_text)

    score = _coerce_score(parsed.get('score', 0.0))
    verdict = _normalise_verdict(parsed.get('verdict'), score)
    feedback = str(parsed.get('llm_feedback') or parsed.get('feedback') or '').strip()
    missing_points = _coerce_string_list(parsed.get('missing_points'))
    wrong_points = _coerce_string_list(parsed.get('wrong_points'))

    if not feedback:
        feedback = _fallback_feedback(verdict, missing_points, wrong_points)

    return {
        "score": score,
        "verdict": verdict,
        "llm_feedback": feedback,
        "missing_points": missing_points,
        "wrong_points": wrong_points,
    }


def _parse_json_object(response_text: str) -> dict | None:
    try:
        parsed = json.loads(response_text)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        match = re.search(r'\{.*\}', response_text, re.DOTALL)
        if not match:
            return None
        try:
            parsed = json.loads(match.group(0))
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            return None


def _coerce_score(value) -> float:
    try:
        score = float(value)
    except Exception:
        score = 0.0
    return max(0.0, min(1.0, score))


def _normalise_verdict(value, score: float) -> str:
    verdict = str(value or '').strip().lower()
    aliases = {
        'wrong': 'incorrect',
        'empty': 'incorrect',
        'unparseable': 'incorrect',
    }
    verdict = aliases.get(verdict, verdict)
    if verdict in ('correct', 'partial', 'incorrect'):
        return verdict
    if score >= 0.9:
        return 'correct'
    if score > 0:
        return 'partial'
    return 'incorrect'


def _coerce_string_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value).strip()
    return [text] if text else []


def _fallback_feedback(verdict: str, missing_points: list[str], wrong_points: list[str]) -> str:
    if missing_points:
        return f"Risposta {verdict}: mancano {', '.join(missing_points)}."
    if wrong_points:
        return f"Risposta {verdict}: contiene errori su {', '.join(wrong_points)}."
    return f"Risposta valutata come {verdict}."


def _fallback_result(verdict: str, feedback: str) -> dict:
    return {
        "score": 0.0,
        "verdict": _normalise_verdict(verdict, 0.0),
        "llm_feedback": feedback,
        "missing_points": [],
        "wrong_points": [],
    }
