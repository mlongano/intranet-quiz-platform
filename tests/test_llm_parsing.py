"""Parsing a model's grading response.

Ported from the llm_evaluator tests when the Datasette `llm` library was
dropped. The behaviour under test is unchanged: tolerant about the shape of the
reply, strict about its substance — an unusable response raises rather than
becoming a zero.
"""

import json

import pytest

from services.llm_errors import LlmInvalidResponseError
from services.llm_parsing import (
    build_user_prompt,
    format_acceptable_answer,
    parse_response,
)


def test_accepts_extra_text_and_rich_feedback():
    response = """
    Here is the result:
    {"score":0.4,"verdict":"partial","llm_feedback":"Coglie solo l'idea generale.","missing_points":["query dinamica","prepared statement"],"wrong_points":[]}
    """

    assert parse_response(response) == {
        'score': 0.4,
        'verdict': 'partial',
        'llm_feedback': "Coglie solo l'idea generale.",
        'missing_points': ['query dinamica', 'prepared statement'],
        'wrong_points': [],
    }


@pytest.mark.parametrize(
    ('payload', 'expected_score', 'expected_verdict'),
    [
        ({'score': 2, 'verdict': 'correct'}, 1.0, 'correct'),
        ({'score': -1, 'verdict': 'wrong'}, 0.0, 'incorrect'),
        ({'score': 0.75, 'verdict': ''}, 0.75, 'partial'),
        ({'score': 0.95, 'verdict': None}, 0.95, 'correct'),
        ({'score': 0.0, 'verdict': 'nonsense'}, 0.0, 'incorrect'),
    ],
)
def test_clamps_score_and_normalises_verdict(payload, expected_score, expected_verdict):
    result = parse_response(json.dumps(payload))
    assert result['score'] == expected_score
    assert result['verdict'] == expected_verdict


@pytest.mark.parametrize('response_text', [None, '', '   ', 'nessun json qui', '[1, 2, 3]'])
def test_rejects_unusable_output(response_text):
    """Unparseable output is an error, never a silent zero-score verdict."""
    with pytest.raises(LlmInvalidResponseError):
        parse_response(response_text)


def test_rejects_response_without_score():
    with pytest.raises(LlmInvalidResponseError):
        parse_response(json.dumps({'verdict': 'correct', 'llm_feedback': 'bene'}))


def test_rejects_non_numeric_score():
    with pytest.raises(LlmInvalidResponseError):
        parse_response(json.dumps({'score': 'molto buono', 'verdict': 'correct'}))


def test_missing_feedback_is_synthesised_from_the_points():
    result = parse_response(json.dumps({
        'score': 0.5, 'verdict': 'partial', 'missing_points': ['il confronto'],
    }))
    assert 'il confronto' in result['llm_feedback']


def test_build_user_prompt_fills_every_placeholder():
    template = 'Q: {{QUESTION}}\nR: {{ACCEPTABLE_ANSWER}}\nS: {{STUDENT_ANSWER}}'

    prompt = build_user_prompt(template, ' Spiega PATCH. ', ' Aggiorna campi. ', ['Solo i campi inviati.'])

    assert 'Q: Spiega PATCH.' in prompt
    assert '- Solo i campi inviati.' in prompt
    assert 'S: Aggiorna campi.' in prompt
    assert '{{' not in prompt


@pytest.mark.parametrize(
    ('value', 'expected'),
    [
        (None, ''),
        ('  una stringa  ', 'una stringa'),
        (['a', 'b'], '- a\n- b'),
    ],
)
def test_format_acceptable_answer(value, expected):
    assert format_acceptable_answer(value) == expected
