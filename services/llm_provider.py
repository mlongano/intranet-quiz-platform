"""Direct provider transport for open-question grading.

Replaces the Datasette `llm` library. That library exposed only the subset of
models its plugins hardcoded, and wrapped a single prompt/response call in an
abstraction we do not otherwise need; it also forced a per-call subprocess to
get a timeout, which the SDKs provide natively.

This module is the only place that talks to a model provider. It returns a
result *or* raises one of the typed errors in services/llm_errors.py — never a
zero score standing in for a failure. Deciding what a failure means (keep the
answer pending, preserve a previous grade) belongs to the worker.

Providers are a hardcoded allowlist. Fase 4 will pass per-teacher credentials
into `evaluate_open_question`; nothing here reads the environment, so that
change is confined to the caller.
"""

from __future__ import annotations

import random
import time

from services.llm_errors import (
    LlmConfigurationError,
    LlmInvalidResponseError,
    LlmTemporaryError,
)
from services.llm_parsing import build_user_prompt, parse_response

# provider -> default base_url. DeepSeek speaks the OpenAI protocol, so it rides
# the same SDK with a different endpoint.
OPENAI_COMPATIBLE = {
    'openai': None,
    'deepseek': 'https://api.deepseek.com/v1',
}
SUPPORTED_PROVIDERS = tuple(OPENAI_COMPATIBLE) + ('anthropic',)

# Grading must be as reproducible as the provider allows: no sampling.
# Recorded per evaluation so a stored grade states the parameters that produced it.
DEFAULT_TEMPERATURE = 0.0
# Output budget. A reasoning model (the school's Qwen3) spends part of it
# thinking before the verdict; at 1024 a long answer used it all up and the
# reply arrived empty. The job pins the value it was enqueued with.
DEFAULT_MAX_TOKENS = 4096


def evaluate_open_question(
    *,
    question_text: str,
    student_answer: str,
    correct_answers,
    provider: str,
    model: str,
    api_key: str,
    system_prompt: str,
    user_prompt_template: str,
    base_url: str | None = None,
    timeout_seconds: float = 25.0,
    retries: int = 0,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> dict:
    """Grade one open answer.

    Returns the parsed result plus the provenance of the call:
    {'score', 'verdict', 'llm_feedback', 'missing_points', 'wrong_points',
     'provider', 'model', 'params'}.

    Raises LlmConfigurationError (needs human intervention — never retried),
    LlmTemporaryError (retried up to *retries* times first), or
    LlmInvalidResponseError (a reply arrived but did not match the schema).
    """
    if provider not in SUPPORTED_PROVIDERS:
        raise LlmConfigurationError(
            f"Unsupported provider {provider!r}. Supported: {', '.join(SUPPORTED_PROVIDERS)}."
        )
    if not model:
        raise LlmConfigurationError("No model configured for LLM evaluation.")
    if not api_key:
        raise LlmConfigurationError(f"No API key configured for provider {provider!r}.")

    user_prompt = build_user_prompt(
        user_prompt_template, question_text, student_answer, correct_answers
    )
    params = {
        'temperature': DEFAULT_TEMPERATURE,
        'max_tokens': max_tokens,
        'timeout_seconds': timeout_seconds,
    }
    call = _anthropic_call if provider == 'anthropic' else _openai_call
    endpoint = base_url if base_url is not None else OPENAI_COMPATIBLE.get(provider)

    result = _with_retries(
        lambda: call(
            model=model,
            api_key=api_key,
            base_url=endpoint,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            timeout_seconds=timeout_seconds,
            max_tokens=max_tokens,
        ),
        retries=retries,
    )

    result['provider'] = provider
    result['model'] = model
    result['params'] = params
    return result


def _with_retries(call, *, retries: int, backoff: float = 0.5) -> dict:
    """Retry only what retrying can fix.

    A configuration error is raised immediately: retrying a bad key or a
    non-existent model just delays the report and burns quota.
    """
    attempt = 0
    last_exc: Exception | None = None
    while attempt <= retries:
        try:
            return call()
        except LlmConfigurationError:
            raise
        except (LlmTemporaryError, LlmInvalidResponseError) as exc:
            last_exc = exc
        attempt += 1
        if attempt <= retries:
            time.sleep(backoff * (2 ** (attempt - 1)) + random.uniform(0, 0.1))

    message = f"LLM request failed after {retries + 1} attempt(s): {last_exc}"
    if isinstance(last_exc, LlmInvalidResponseError):
        raise LlmInvalidResponseError(message)
    raise LlmTemporaryError(message)


def _truncated(max_tokens: int) -> LlmInvalidResponseError:
    return LlmInvalidResponseError(
        f"Risposta troncata: il modello ha esaurito i {max_tokens} token di uscita "
        f"prima di dare il giudizio (aumentare LLM_MAX_TOKENS)."
    )


def _openai_call(
    *, model, api_key, base_url, system_prompt, user_prompt, timeout_seconds, max_tokens
) -> dict:
    import openai

    client = openai.OpenAI(api_key=api_key, base_url=base_url, timeout=timeout_seconds, max_retries=0)
    try:
        response = client.chat.completions.create(
            model=model,
            temperature=DEFAULT_TEMPERATURE,
            max_tokens=max_tokens,
            response_format={'type': 'json_object'},
            messages=[
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_prompt},
            ],
        )
    except Exception as exc:
        raise _map_sdk_error(exc, 'openai')

    try:
        choice = response.choices[0]
        text = choice.message.content
    except (AttributeError, IndexError, TypeError) as exc:
        raise LlmInvalidResponseError(f"Unexpected OpenAI response shape: {exc}")
    if getattr(choice, 'finish_reason', None) == 'length' and not (text or '').strip():
        raise _truncated(max_tokens)
    return parse_response(text)


def _anthropic_call(
    *, model, api_key, base_url, system_prompt, user_prompt, timeout_seconds, max_tokens
) -> dict:
    import anthropic

    client = anthropic.Anthropic(
        api_key=api_key, base_url=base_url, timeout=timeout_seconds, max_retries=0
    )
    try:
        response = client.messages.create(
            model=model,
            system=system_prompt,
            temperature=DEFAULT_TEMPERATURE,
            max_tokens=max_tokens,
            messages=[{'role': 'user', 'content': user_prompt}],
        )
    except Exception as exc:
        raise _map_sdk_error(exc, 'anthropic')

    try:
        text = ''.join(
            block.text for block in response.content if getattr(block, 'type', None) == 'text'
        )
    except (AttributeError, TypeError) as exc:
        raise LlmInvalidResponseError(f"Unexpected Anthropic response shape: {exc}")
    if getattr(response, 'stop_reason', None) == 'max_tokens' and not text.strip():
        raise _truncated(max_tokens)
    return parse_response(text)


def _map_sdk_error(exc: Exception, provider: str) -> Exception:
    """Translate an SDK exception into our taxonomy.

    Both SDKs expose the same class names, so one mapping serves both. The split
    that matters is retryable (transport, rate limit, provider 5xx) versus
    "a human must fix this" (credentials, unknown model, malformed request).
    """
    if isinstance(exc, (LlmConfigurationError, LlmTemporaryError, LlmInvalidResponseError)):
        return exc

    sdk = _sdk_module(provider)
    if sdk is not None:
        configuration = tuple(
            getattr(sdk, name)
            for name in ('AuthenticationError', 'PermissionDeniedError', 'NotFoundError',
                         'BadRequestError', 'UnprocessableEntityError')
            if hasattr(sdk, name)
        )
        temporary = tuple(
            getattr(sdk, name)
            for name in ('APITimeoutError', 'APIConnectionError', 'RateLimitError',
                         'InternalServerError')
            if hasattr(sdk, name)
        )
        if configuration and isinstance(exc, configuration):
            return LlmConfigurationError(f"{provider}: {exc}")
        if temporary and isinstance(exc, temporary):
            return LlmTemporaryError(f"{provider}: {exc}")

    # Unknown failures are treated as temporary: the worker keeps the answer
    # pending and a human can retry, which is the safe direction.
    return LlmTemporaryError(f"{provider}: {exc}")


def _sdk_module(provider: str):
    try:
        if provider == 'anthropic':
            import anthropic
            return anthropic
        import openai
        return openai
    except ImportError:  # pragma: no cover - dependency is declared in pyproject
        return None
