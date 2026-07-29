"""Typed LLM failures.

The grading pipeline must never turn a failed evaluation into a zero-point
grade: a failure leaves the answer pending, and only the worker decides what
to record. These exceptions are how the evaluator tells the worker *why* an
evaluation did not produce a score.

Shared by llm_evaluator.py, services/grading.py and services/llm_jobs.py.
"""

from __future__ import annotations

import os


class LlmError(Exception):
    """Base class for every LLM evaluation failure."""


class LlmTemporaryError(LlmError):
    """Timeout, rate limit or provider unavailability: retrying may succeed."""


class LlmConfigurationError(LlmError):
    """Credentials, model or endpoint are invalid: needs teacher intervention."""


class LlmInvalidResponseError(LlmError):
    """A response arrived but does not match the expected schema."""


def llm_enabled() -> bool:
    return os.getenv('USE_LLM_EVAL', '0') == '1'


def validate_llm_env() -> None:
    """Raise LlmConfigurationError when USE_LLM_EVAL=1 but the setup is incomplete.

    Called at startup by both server.py and the grading worker so a
    misconfigured deployment is reported loudly instead of silently leaving
    every open answer pending.
    """
    if not llm_enabled():
        return
    if not (os.getenv('LLM_MODEL') or '').strip():
        raise LlmConfigurationError(
            "USE_LLM_EVAL=1 but LLM_MODEL is not set."
        )
