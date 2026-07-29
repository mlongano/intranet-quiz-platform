"""Versioned prompt resolution.

The guarantee under test: a recorded prompt_version identifies exactly one
text, so a historical evaluation stays explainable.
"""

import pytest

from services import prompts


def test_active_prompts_resolve_and_are_versioned():
    for name in (prompts.SYSTEM_PROMPT_NAME, prompts.USER_PROMPT_NAME):
        version, text = prompts.load_active_prompt(name)
        assert text.strip(), f"{name} prompt is empty"
        assert version.startswith('v')


def test_published_prompt_content_matches_its_filename_hash():
    """The published files must not have been edited in place."""
    for name in (prompts.SYSTEM_PROMPT_NAME, prompts.USER_PROMPT_NAME):
        version, text = prompts.load_active_prompt(name)
        assert version.split('-', 1)[1] == prompts.content_hash(text)


def test_edited_published_prompt_is_rejected(tmp_path, monkeypatch):
    """Editing a released prompt in place must fail loudly, not silently grade."""
    directory = tmp_path / 'open-question-system'
    directory.mkdir()
    # Filename claims a hash the content does not have.
    (directory / 'v1-deadbeef.md').write_text('tampered content', encoding='utf-8')
    monkeypatch.setattr(prompts, 'PROMPT_DIR', tmp_path)

    with pytest.raises(ValueError, match='modified after publication'):
        prompts.load_active_prompt(prompts.SYSTEM_PROMPT_NAME)


def test_highest_major_version_wins(tmp_path, monkeypatch):
    directory = tmp_path / 'open-question-system'
    directory.mkdir()
    for text, major in (('first wording', 1), ('second wording', 2)):
        digest = prompts.content_hash(text)
        (directory / f'v{major}-{digest}.md').write_text(text, encoding='utf-8')
    monkeypatch.setattr(prompts, 'PROMPT_DIR', tmp_path)

    version, text = prompts.load_active_prompt(prompts.SYSTEM_PROMPT_NAME)
    assert text == 'second wording'
    assert version.startswith('v2-')


def test_env_override_is_reported_as_custom(tmp_path, monkeypatch):
    override = tmp_path / 'my-prompt.md'
    override.write_text('deployment specific wording', encoding='utf-8')
    monkeypatch.setenv('LLM_OPEN_QUESTION_SYSTEM_PROMPT_PATH', str(override))

    version, text = prompts.load_active_prompt(prompts.SYSTEM_PROMPT_NAME)
    assert text == 'deployment specific wording'
    assert version == f"custom-{prompts.content_hash(text)}"


def test_active_prompt_set_combines_both_versions():
    result = prompts.active_prompt_set()
    assert set(result) == {'version', 'system', 'user'}
    assert '+' in result['version']
    assert result['system'] != result['user']


def test_load_prompt_version_reads_a_specific_release():
    version, expected = prompts.load_active_prompt(prompts.SYSTEM_PROMPT_NAME)
    assert prompts.load_prompt_version(prompts.SYSTEM_PROMPT_NAME, version) == expected


def test_load_prompt_version_raises_for_unknown_version():
    with pytest.raises(FileNotFoundError):
        prompts.load_prompt_version(prompts.SYSTEM_PROMPT_NAME, 'v99-abcdef12')


def test_system_prompt_requires_a_reason_for_non_perfect_scores():
    """Teachers rely on feedback explaining why full credit was withheld."""
    _version, system_prompt = prompts.load_active_prompt(prompts.SYSTEM_PROMPT_NAME)

    assert 'If `score` is lower than `1.0`' in system_prompt
    assert 'Do not write only positive feedback for a score lower than `1.0`' in system_prompt
    assert 'Hypervisor di Tipo 1' in system_prompt


def test_user_prompt_has_the_placeholders_the_builder_fills():
    _version, user_prompt = prompts.load_active_prompt(prompts.USER_PROMPT_NAME)

    for placeholder in ('{{QUESTION}}', '{{ACCEPTABLE_ANSWER}}', '{{STUDENT_ANSWER}}'):
        assert placeholder in user_prompt
