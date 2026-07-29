"""Direct provider transport.

The invariant these guard: a failed evaluation raises, and never returns a
score. A zero that means "the provider was down" is indistinguishable from a
zero that means "the student was wrong" once it reaches a gradebook.
"""

import json
import types

import pytest

from services import llm_provider
from services.llm_errors import (
    LlmConfigurationError,
    LlmInvalidResponseError,
    LlmTemporaryError,
)

GOOD_PAYLOAD = {
    'score': 0.75,
    'verdict': 'partial',
    'llm_feedback': 'Corretto in parte.',
    'missing_points': ['Confronto esplicito'],
    'wrong_points': [],
}

BASE_KWARGS = dict(
    question_text='Spiega PATCH.',
    student_answer='Aggiorna alcuni campi.',
    correct_answers=['Aggiorna solo i campi inviati.'],
    api_key='sk-test',
    system_prompt='system wording',
    user_prompt_template='Q: {{QUESTION}}\nA: {{ACCEPTABLE_ANSWER}}\nS: {{STUDENT_ANSWER}}',
)


# ── fakes ────────────────────────────────────────────────────────────────────

def _openai_client(*, text=None, raises=None, recorder=None):
    def create(**kwargs):
        if recorder is not None:
            recorder.update(kwargs)
        if raises is not None:
            raise raises
        message = types.SimpleNamespace(content=text)
        return types.SimpleNamespace(choices=[types.SimpleNamespace(message=message)])

    completions = types.SimpleNamespace(create=create)
    return types.SimpleNamespace(chat=types.SimpleNamespace(completions=completions))


def _anthropic_client(*, text=None, raises=None, recorder=None):
    def create(**kwargs):
        if recorder is not None:
            recorder.update(kwargs)
        if raises is not None:
            raise raises
        block = types.SimpleNamespace(type='text', text=text)
        return types.SimpleNamespace(content=[block])

    return types.SimpleNamespace(messages=types.SimpleNamespace(create=create))


@pytest.fixture
def patch_openai(monkeypatch):
    def _patch(**kwargs):
        import openai
        monkeypatch.setattr(openai, 'OpenAI', lambda **_: _openai_client(**kwargs))
    return _patch


@pytest.fixture
def patch_anthropic(monkeypatch):
    def _patch(**kwargs):
        import anthropic
        monkeypatch.setattr(anthropic, 'Anthropic', lambda **_: _anthropic_client(**kwargs))
    return _patch


# ── happy paths ──────────────────────────────────────────────────────────────

def test_openai_returns_result_with_provenance(patch_openai):
    patch_openai(text=json.dumps(GOOD_PAYLOAD))

    result = llm_provider.evaluate_open_question(
        provider='openai', model='gpt-4o-mini', **BASE_KWARGS
    )

    assert result['score'] == 0.75
    assert result['verdict'] == 'partial'
    assert result['provider'] == 'openai'
    assert result['model'] == 'gpt-4o-mini'
    assert result['params']['temperature'] == 0.0


def test_anthropic_returns_result_with_provenance(patch_anthropic):
    patch_anthropic(text=json.dumps(GOOD_PAYLOAD))

    result = llm_provider.evaluate_open_question(
        provider='anthropic', model='claude-sonnet-4', **BASE_KWARGS
    )

    assert result['score'] == 0.75
    assert result['provider'] == 'anthropic'
    assert result['model'] == 'claude-sonnet-4'


def test_deepseek_uses_the_openai_transport(monkeypatch):
    import openai
    seen = {}

    def fake_openai(**kwargs):
        seen.update(kwargs)
        return _openai_client(text=json.dumps(GOOD_PAYLOAD))

    monkeypatch.setattr(openai, 'OpenAI', fake_openai)
    result = llm_provider.evaluate_open_question(
        provider='deepseek', model='deepseek-chat', **BASE_KWARGS
    )

    assert result['provider'] == 'deepseek'
    assert seen['base_url'] == llm_provider.OPENAI_COMPATIBLE['deepseek']


def test_prompt_placeholders_are_filled(patch_openai):
    recorder = {}
    patch_openai(text=json.dumps(GOOD_PAYLOAD), recorder=recorder)

    llm_provider.evaluate_open_question(provider='openai', model='m', **BASE_KWARGS)

    user_message = recorder['messages'][1]['content']
    assert 'Spiega PATCH.' in user_message
    assert 'Aggiorna alcuni campi.' in user_message
    assert '{{QUESTION}}' not in user_message
    assert recorder['messages'][0]['content'] == 'system wording'


def test_json_embedded_in_prose_is_recovered(patch_openai):
    patch_openai(text=f"Ecco la valutazione:\n```json\n{json.dumps(GOOD_PAYLOAD)}\n```")

    result = llm_provider.evaluate_open_question(provider='openai', model='m', **BASE_KWARGS)
    assert result['score'] == 0.75


# ── failures never become grades ─────────────────────────────────────────────

@pytest.mark.parametrize('bad_text', ['', '   ', 'nessun json qui', '[1, 2, 3]'])
def test_unusable_response_raises_invalid(patch_openai, bad_text):
    patch_openai(text=bad_text)

    with pytest.raises(LlmInvalidResponseError):
        llm_provider.evaluate_open_question(provider='openai', model='m', **BASE_KWARGS)


def test_missing_score_field_raises_invalid(patch_openai):
    patch_openai(text=json.dumps({'verdict': 'correct', 'llm_feedback': 'ok'}))

    with pytest.raises(LlmInvalidResponseError):
        llm_provider.evaluate_open_question(provider='openai', model='m', **BASE_KWARGS)


def test_non_numeric_score_raises_instead_of_scoring_zero(patch_openai):
    patch_openai(text=json.dumps({'score': 'boh', 'verdict': 'incorrect'}))

    with pytest.raises(LlmInvalidResponseError):
        llm_provider.evaluate_open_question(provider='openai', model='m', **BASE_KWARGS)


def _sdk_error(sdk, name, status):
    """Build a real SDK exception — they require an httpx request/response."""
    import httpx
    request = httpx.Request('POST', 'https://api.example.com/v1/chat/completions')
    if name == 'APITimeoutError':
        return sdk.APITimeoutError(request=request)
    response = httpx.Response(status, request=request)
    return getattr(sdk, name)('boom', response=response, body=None)


def _counting_openai(monkeypatch, exc_factory, calls):
    import openai

    def fake_openai(**_):
        def create(**kwargs):
            calls.append(kwargs)
            raise exc_factory()
        return types.SimpleNamespace(
            chat=types.SimpleNamespace(completions=types.SimpleNamespace(create=create))
        )

    monkeypatch.setattr(openai, 'OpenAI', fake_openai)


def test_authentication_error_is_configuration_and_not_retried(monkeypatch):
    import openai
    calls = []
    _counting_openai(
        monkeypatch, lambda: _sdk_error(openai, 'AuthenticationError', 401), calls
    )

    with pytest.raises(LlmConfigurationError):
        llm_provider.evaluate_open_question(
            provider='openai', model='m', retries=3, **BASE_KWARGS
        )
    assert len(calls) == 1, "a bad credential must not be retried"


def test_unknown_model_is_configuration_and_not_retried(monkeypatch):
    import openai
    calls = []
    _counting_openai(monkeypatch, lambda: _sdk_error(openai, 'NotFoundError', 404), calls)

    with pytest.raises(LlmConfigurationError):
        llm_provider.evaluate_open_question(
            provider='openai', model='no-such-model', retries=3, **BASE_KWARGS
        )
    assert len(calls) == 1


def test_timeout_is_temporary_and_retried(monkeypatch):
    import openai
    calls = []
    _counting_openai(monkeypatch, lambda: _sdk_error(openai, 'APITimeoutError', 408), calls)
    monkeypatch.setattr(llm_provider.time, 'sleep', lambda _s: None)

    with pytest.raises(LlmTemporaryError):
        llm_provider.evaluate_open_question(
            provider='openai', model='m', retries=2, **BASE_KWARGS
        )
    assert len(calls) == 3, "initial attempt plus two retries"


def test_rate_limit_is_temporary(monkeypatch):
    import openai
    calls = []
    _counting_openai(monkeypatch, lambda: _sdk_error(openai, 'RateLimitError', 429), calls)
    monkeypatch.setattr(llm_provider.time, 'sleep', lambda _s: None)

    with pytest.raises(LlmTemporaryError):
        llm_provider.evaluate_open_question(
            provider='openai', model='m', retries=1, **BASE_KWARGS
        )
    assert len(calls) == 2


def test_anthropic_errors_map_through_the_same_taxonomy(monkeypatch):
    import anthropic

    def fake_anthropic(**_):
        def create(**_kwargs):
            raise _sdk_error(anthropic, 'AuthenticationError', 401)
        return types.SimpleNamespace(messages=types.SimpleNamespace(create=create))

    monkeypatch.setattr(anthropic, 'Anthropic', fake_anthropic)

    with pytest.raises(LlmConfigurationError):
        llm_provider.evaluate_open_question(
            provider='anthropic', model='claude-sonnet-4', **BASE_KWARGS
        )


def test_unknown_sdk_error_is_treated_as_temporary(patch_openai):
    patch_openai(raises=RuntimeError('something unexpected'))

    with pytest.raises(LlmTemporaryError):
        llm_provider.evaluate_open_question(provider='openai', model='m', **BASE_KWARGS)


# ── configuration guards ─────────────────────────────────────────────────────

def test_unknown_provider_is_rejected():
    with pytest.raises(LlmConfigurationError, match='Unsupported provider'):
        llm_provider.evaluate_open_question(provider='ollama', model='m', **BASE_KWARGS)


def test_missing_api_key_is_configuration_error():
    kwargs = {**BASE_KWARGS, 'api_key': ''}
    with pytest.raises(LlmConfigurationError, match='API key'):
        llm_provider.evaluate_open_question(provider='openai', model='m', **kwargs)


def test_missing_model_is_configuration_error():
    with pytest.raises(LlmConfigurationError, match='model'):
        llm_provider.evaluate_open_question(provider='openai', model='', **BASE_KWARGS)
