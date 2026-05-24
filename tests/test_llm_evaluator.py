import json
import time

import pytest


def hanging_prompt_worker(*_args, **_kwargs):
    time.sleep(5)


def test_build_prompt_loads_markdown_template_and_formats_rubric(monkeypatch, tmp_path):
    import llm_evaluator

    template_path = tmp_path / 'prompt.md'
    template_path.write_text(
        '# Task\nQ={{QUESTION}}\nA={{ACCEPTABLE_ANSWER}}\nS={{STUDENT_ANSWER}}\n',
        encoding='utf-8',
    )
    monkeypatch.setenv('LLM_OPEN_QUESTION_USER_PROMPT_PATH', str(template_path))

    prompt = llm_evaluator._build_prompt(
        'Che cosa fa PATCH?',
        'Aggiorna solo alcuni campi.',
        ['Aggiorna parzialmente', 'Non sovrascrive i campi assenti'],
    )

    assert 'Q=Che cosa fa PATCH?' in prompt
    assert '- Aggiorna parzialmente' in prompt
    assert '- Non sovrascrive i campi assenti' in prompt
    assert 'S=Aggiorna solo alcuni campi.' in prompt


def test_system_prompt_requires_missing_reason_for_non_perfect_scores():
    import llm_evaluator

    system_prompt = llm_evaluator._load_system_prompt()

    assert 'If `score` is lower than `1.0`' in system_prompt
    assert 'Do not write only positive feedback for a score lower than `1.0`' in system_prompt
    assert 'Hypervisor di Tipo 1' in system_prompt


def test_parse_llm_response_accepts_extra_text_and_rich_feedback():
    import llm_evaluator

    response = """
    Here is the result:
    {"score":0.4,"verdict":"partial","llm_feedback":"Coglie solo l'idea generale.","missing_points":["query dinamica","prepared statement"],"wrong_points":[]}
    """

    result = llm_evaluator._parse_llm_response(response)

    assert result == {
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
    ],
)
def test_parse_llm_response_clamps_score_and_normalises_verdict(
    payload,
    expected_score,
    expected_verdict,
):
    import llm_evaluator

    result = llm_evaluator._parse_llm_response(json.dumps(payload))

    assert result['score'] == expected_score
    assert result['verdict'] == expected_verdict


def test_prompt_with_timeout_raises_when_worker_hangs(monkeypatch):
    import llm_evaluator

    monkeypatch.setattr(llm_evaluator, '_prompt_worker', hanging_prompt_worker)

    started = time.monotonic()
    with pytest.raises(TimeoutError):
        llm_evaluator._prompt_with_timeout('model', 'prompt', 'system', 0.1)

    assert time.monotonic() - started < 2
