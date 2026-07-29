"""Parsing and normalisation of a model's grading response.

Moved out of llm_evaluator.py when the Datasette `llm` library was replaced by
direct SDKs. The logic is deliberately tolerant about *shape* — models wrap JSON
in prose or code fences — but strict about *substance*: a response that cannot
be understood raises LlmInvalidResponseError instead of yielding a zero, because
a failed evaluation must never be mistaken for a grade of 0.
"""

from __future__ import annotations

import json
import re

from services.llm_errors import LlmInvalidResponseError

VERDICTS = ('correct', 'partial', 'incorrect')


def parse_response(response_text: str | None) -> dict:
    """Parse a raw model response into the grading result shape.

    Raises LlmInvalidResponseError when the response is empty or holds no JSON
    object — the worker turns that into a retry or a preserved `pending`.
    """
    if response_text is None or not str(response_text).strip():
        raise LlmInvalidResponseError("Model returned an empty response.")

    text = response_text if isinstance(response_text, str) else str(response_text)
    parsed = _parse_json_object(text)
    if parsed is None:
        raise LlmInvalidResponseError(
            f"Model response contained no JSON object: {text[:200]!r}"
        )
    if 'score' not in parsed:
        raise LlmInvalidResponseError(
            f"Model response has no 'score' field: {text[:200]!r}"
        )

    score = coerce_score(parsed.get('score'))
    verdict = normalise_verdict(parsed.get('verdict'), score)
    feedback = str(parsed.get('llm_feedback') or parsed.get('feedback') or '').strip()
    missing_points = coerce_string_list(parsed.get('missing_points'))
    wrong_points = coerce_string_list(parsed.get('wrong_points'))

    if not feedback:
        feedback = fallback_feedback(verdict, missing_points, wrong_points)

    return {
        'score': score,
        'verdict': verdict,
        'llm_feedback': feedback,
        'missing_points': missing_points,
        'wrong_points': wrong_points,
    }


def _parse_json_object(response_text: str) -> dict | None:
    """Whole-string JSON first, then the widest {...} span (handles fences/prose)."""
    try:
        parsed = json.loads(response_text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    match = re.search(r'\{.*\}', response_text, re.DOTALL)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def coerce_score(value) -> float:
    """Clamp to 0.0-1.0. A non-numeric score is a schema violation, not a zero."""
    try:
        score = float(value)
    except (TypeError, ValueError):
        raise LlmInvalidResponseError(f"Score is not a number: {value!r}")
    return max(0.0, min(1.0, score))


def normalise_verdict(value, score: float) -> str:
    verdict = str(value or '').strip().lower()
    verdict = {'wrong': 'incorrect'}.get(verdict, verdict)
    if verdict in VERDICTS:
        return verdict
    if score >= 0.9:
        return 'correct'
    if score > 0:
        return 'partial'
    return 'incorrect'


def coerce_string_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value).strip()
    return [text] if text else []


def fallback_feedback(verdict: str, missing_points: list[str], wrong_points: list[str]) -> str:
    if missing_points:
        return f"Risposta {verdict}: mancano {', '.join(missing_points)}."
    if wrong_points:
        return f"Risposta {verdict}: contiene errori su {', '.join(wrong_points)}."
    return f"Risposta valutata come {verdict}."


def build_user_prompt(template: str, question_text, user_answer, correct_answers) -> str:
    return (
        template
        .replace('{{QUESTION}}', str(question_text or '').strip())
        .replace('{{ACCEPTABLE_ANSWER}}', format_acceptable_answer(correct_answers))
        .replace('{{STUDENT_ANSWER}}', str(user_answer or '').strip())
    )


def format_acceptable_answer(correct_answers) -> str:
    if correct_answers is None:
        return ''
    if isinstance(correct_answers, str):
        return correct_answers.strip()
    if isinstance(correct_answers, (list, tuple)):
        return '\n'.join(f"- {str(answer).strip()}" for answer in correct_answers)
    return str(correct_answers).strip()
