"""
Grading logic. Pure functions — no DB or Flask dependencies.
Moved from utils.py; signatures are unchanged so existing callers keep working.
"""

# ── imports ───────────────────────────────────────────────────────────────────

import copy as _copy
import os
import re
import unicodedata


def normalise(txt: str) -> str:
    if not isinstance(txt, str):
        return ""
    txt = unicodedata.normalize('NFKD', txt).lower()
    txt = re.sub(r'\s+', ' ', txt, flags=re.MULTILINE).strip()
    return txt


def score_open(user_ans: str, q: dict) -> float:
    ua = normalise(user_ans)
    if 'acceptable' in q:
        for a in q['acceptable']:
            if ua == normalise(a):
                return 1.0
    if 'keywords' in q:
        kw = [normalise(k) for k in q['keywords']]
        hits = sum(1 for k in kw if k in ua)
        if 'min_keywords' in q:
            return 1.0 if hits >= q['min_keywords'] else 0.0
        elif kw:
            return hits / len(kw)
    return 0.0


def grade(answers: list, plan: dict, qbank: dict) -> dict:
    """
    Calculates score based on answers, the student's shuffled plan, and the question bank.

    Args:
        answers:  list of raw student answers (indexed by plan position)
        plan:     quiz_plans row as a dict; must have a 'plan' key with [{id, option_order}]
        qbank:    question_snapshots.content parsed — dict with 'questions' list
    """
    total = 0.0
    maximum = 0.0
    per_question_scores: list[float] = []
    per_question_feedbacks: list = []
    per_question_verdicts: list = []

    questions_list = qbank.get('questions', qbank) if isinstance(qbank, dict) else qbank
    qbank_map = {str(q['id']): q for q in questions_list}

    use_llm = os.getenv('USE_LLM_EVAL', '0') == '1'

    for i, step in enumerate(plan.get('plan', [])):
        q_id = str(step.get('id'))
        question_score = 0.0

        if not q_id or q_id not in qbank_map:
            print(f"Warning: Question ID '{q_id}' from plan step {i} not found in question bank.")
            per_question_scores.append(0.0)
            per_question_feedbacks.append(None)
            per_question_verdicts.append(None)
            continue

        q = qbank_map[q_id]
        user_ans = answers[i] if i < len(answers) else None
        w = q.get('weight', 1)
        maximum += w

        q_type = q.get('type')
        llm_feedback = None
        llm_verdict = None

        if q_type == 'open':
            if use_llm:
                try:
                    from llm_evaluator import evaluate_open_question  # type: ignore[import]
                    correct_answers = q.get('acceptable') or q.get('keywords') or []
                    llm_result = evaluate_open_question(q.get('text', ''), user_ans or '', correct_answers)
                    open_score_fraction = float(llm_result.get('score', 0))
                    question_score = w * open_score_fraction
                    llm_feedback = llm_result.get('llm_feedback')
                    llm_verdict = llm_result.get('verdict')
                except Exception as e:
                    print(f"LLM evaluation failed: {e}. Falling back to keyword scoring.")
                    question_score = w * score_open(user_ans or '', q)
            else:
                question_score = w * score_open(user_ans or '', q)

        elif q_type == 'single':
            original_correct_index = q.get('correct')
            shuffled_options = step.get('option_order', [])
            if original_correct_index is not None and isinstance(shuffled_options, list):
                try:
                    current_correct_index = shuffled_options.index(original_correct_index)
                    if user_ans == current_correct_index:
                        question_score = w
                except ValueError:
                    print(f"Warning: Correct index {original_correct_index} not in option_order for q {q_id}")

        elif q_type == 'multiple':
            original_correct_indices = q.get('correct', [])
            shuffled_options = step.get('option_order', [])
            user_selected_original = []

            if isinstance(user_ans, list):
                for ans_index in user_ans:
                    if isinstance(ans_index, int) and 0 <= ans_index < len(shuffled_options):
                        user_selected_original.append(shuffled_options[ans_index])

            num_options = len(shuffled_options)
            num_correct_total = len(original_correct_indices)
            num_user_correct = len([i for i in user_selected_original if i in original_correct_indices])
            num_user_wrong = len([i for i in user_selected_original if i not in original_correct_indices])

            if num_correct_total > 0:
                points_per_correct = w / num_correct_total
                wrong_pool = num_options - num_correct_total
                points_per_wrong = w / wrong_pool if wrong_pool > 0 else w
                raw = (num_user_correct * points_per_correct) - (num_user_wrong * points_per_wrong)
                question_score = max(0.0, raw)

        total += question_score
        per_question_scores.append(round(question_score, 2))
        per_question_feedbacks.append(llm_feedback)
        per_question_verdicts.append(llm_verdict)

    return {
        'raw_points': round(total, 2),
        'max_points': maximum,
        'percent': round(total / maximum * 100, 2) if maximum else 0,
        'scores_per_question': per_question_scores,
        'feedbacks_per_question': per_question_feedbacks,
        'verdicts_per_question': per_question_verdicts,
    }


def format_detailed_answers(
    plan: dict,
    qbank_map: dict,
    answers: list,
    scores_list: list,
    feedbacks_list: list | None = None,
    verdicts_list: list | None = None,
) -> list:
    """Formats per-question answer detail for storage in score_entries.answers."""
    detailed_answers = []
    plan_steps = plan.get('plan', [])

    for i, step in enumerate(plan_steps):
        q_id = str(step.get('id'))
        question_detail = qbank_map.get(q_id)
        student_answer_raw = answers[i] if i < len(answers) else None
        formatted_student_answer = student_answer_raw
        option_student_image = None
        formatted_correct_answer = "[N/A]"
        option_correct_image = None
        question_text = "[Question not found]"
        question_image_path = None
        points = scores_list[i] if i < len(scores_list) else 0
        llm_feedback = feedbacks_list[i] if feedbacks_list and i < len(feedbacks_list) else None
        llm_verdict = verdicts_list[i] if verdicts_list and i < len(verdicts_list) else None
        question_weight = 0
        correct_answer_raw = None
        shuffled_option_order: list = []

        if question_detail:
            question_text = question_detail.get('text', '[Text missing]')
            question_image_path = question_detail.get('question_image')
            question_weight = question_detail.get('weight', 1)
            q_type = question_detail.get('type')
            original_options = question_detail.get('options', [])
            shuffled_option_order = step.get('option_order', [])
            correct_answer_raw = question_detail.get('correct')

            def get_option_text(option):
                return option.get('text', '') if isinstance(option, dict) else str(option)

            def get_option_image(option):
                return option.get('image') if isinstance(option, dict) else None

            if q_type == 'single' and isinstance(student_answer_raw, int) and 0 <= student_answer_raw < len(shuffled_option_order):
                orig_idx = shuffled_option_order[student_answer_raw]
                if 0 <= orig_idx < len(original_options):
                    option_text = get_option_text(original_options[orig_idx])
                    option_student_image = get_option_image(original_options[orig_idx])
                    formatted_student_answer = f"'{option_text}' (Index: {orig_idx})"
                else:
                    formatted_student_answer = f"[Invalid Shuffled Index: {student_answer_raw}]"
            elif q_type == 'multiple' and isinstance(student_answer_raw, list):
                orig_indices = [
                    shuffled_option_order[idx]
                    for idx in student_answer_raw
                    if isinstance(idx, int) and 0 <= idx < len(shuffled_option_order)
                ]
                formatted_student_answer = [
                    f"'{get_option_text(original_options[oi])}' (Index: {oi})"
                    for oi in orig_indices if 0 <= oi < len(original_options)
                ]
                option_student_image = [
                    get_option_image(original_options[oi])
                    for oi in orig_indices if 0 <= oi < len(original_options)
                ]

            if q_type == 'single' and isinstance(correct_answer_raw, int) and 0 <= correct_answer_raw < len(original_options):
                option_text = get_option_text(original_options[correct_answer_raw])
                option_correct_image = get_option_image(original_options[correct_answer_raw])
                formatted_correct_answer = f"'{option_text}' (Index: {correct_answer_raw})"
            elif q_type == 'multiple' and isinstance(correct_answer_raw, list):
                formatted_correct_answer = [
                    f"'{get_option_text(original_options[idx])}' (Index: {idx})"
                    for idx in correct_answer_raw if 0 <= idx < len(original_options)
                ]
                option_correct_image = [
                    get_option_image(original_options[idx])
                    for idx in correct_answer_raw if 0 <= idx < len(original_options)
                ]
            elif q_type == 'open':
                if 'acceptable' in question_detail:
                    formatted_correct_answer = question_detail['acceptable']
                elif 'keywords' in question_detail:
                    formatted_correct_answer = {'keywords': question_detail['keywords']}
                else:
                    formatted_correct_answer = "[Manual Grading Required]"
            else:
                formatted_correct_answer = "[Invalid Question Type]"

        question_snapshot = _copy.deepcopy(question_detail) if question_detail else None

        detailed_answers.append({
            "question_id": q_id,
            "question_snapshot": question_snapshot,
            "question_text": question_text,
            "question_image": question_image_path,
            "student_answer": formatted_student_answer,
            "option_student_image": option_student_image,
            "option_correct_image": option_correct_image,
            "correct_answer": formatted_correct_answer,
            "weight": question_weight,
            "points_awarded": points,
            "raw_points": points,
            "llm_feedback": llm_feedback,
            "llm_verdict": llm_verdict,
            "raw_student_answer": student_answer_raw,
            "raw_correct_answer": correct_answer_raw if question_detail else None,
            "option_order": shuffled_option_order,
        })

    return detailed_answers
