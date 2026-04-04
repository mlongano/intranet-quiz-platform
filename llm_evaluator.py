import os
import time
import random
import llm

SYSTEM_PROMPT = (
    "You are an expert AI evaluator tasked with grading a student's answer against a rubric.\n"
    "Your primary objective is to rigorously compare the **student_answer** against the **correct_answer** (which serves as the definitive grading rubric).\n"
    "You must evaluate based on semantic equivalence, not superficial keyword matching.\n"
    "Crucially, you must pay close attention to *all* components of the **question**. The student must address every distinct part to receive full credit.\n\n"
    "## Output Format\n"
    "Return JSON *only* with exactly these keys: {\"score\": float, \"verdict\": string, \"llm_feedback\": string}.\n"
    "* **score**: A float between 0.0 (no credit) and 1.0 (full credit). Assign partial credit proportionally to the components answered correctly.\n"
    "* **verdict**: A single string: 'correct', 'partial', or 'incorrect'.\n"
    "* **llm_feedback**: A concise (<= 170 chars) and constructive justification for the score. It must clearly state what was correct and what was missing or incorrect, referencing the rubric.\n\n"
    "## Examples\n"
    "1) Question: 'Capital of France?'; Correct answers: ['Paris']; Student answer: 'Paris'\n"
    "   -> {\"score\":1.0,\"verdict\":\"correct\",\"llm_feedback\":\"Correct. The answer exactly matches the rubric.\"}\n\n"
    "2) Question: 'Descrivi brevemente cosa sono una 'race condition' e un 'deadlock' e qual è la principale differenza nel loro esito'; Correct Answer: 'Una 'race condition' ... portando a risultati errati... Un 'deadlock' ... causando un arresto completo... L'esito... è un dato scorretto, ... blocco del programma.'; Student answer: 'una race condition è ... risultati non deterministici. Un deadlock accade ... rimangono in attesa indefinitivamente'\n"
    "   -> {\"score\":0.8,\"verdict\":\"partial\",\"llm_feedback\":\"Le definizioni di 'race condition' e 'deadlock' sono corrette. Manca la comparazione esplicita della *principale differenza nel loro esito* (dati errati vs. blocco).\"}\n\n"
    "3) Question: 'Name three noble gases.'; Correct answers include ['helium','neon','argon','krypton','xenon','radon']; Student answer: 'helium, neon'\n"
    "   -> {\"score\":0.5,\"verdict\":\"partial\",\"llm_feedback\":\"Provides two valid gases (helium, neon) but the question asked for three.\"}\n\n"
    "Respond with JSON only and nothing else."
)


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
    retries = int(os.getenv("LLM_RETRIES", "2"))
    backoff = float(os.getenv("LLM_BACKOFF_FACTOR", "0.5"))

    try:
        model = llm.get_model(model_id)
    except Exception as e:
        raise RuntimeError(
            f"Cannot load model '{model_id}': {e}. "
            f"Make sure the llm plugin for this provider is installed "
            f"(e.g. 'uv add llm-anthropic' or 'uv add llm-ollama')."
        )

    prompt = _build_prompt(question_text, user_answer, correct_answers)

    attempt = 0
    last_exc = None
    while attempt <= retries:
        try:
            response = model.prompt(prompt, system=SYSTEM_PROMPT)
            return _parse_llm_response(response.text())
        except Exception as e:
            last_exc = e
            sleep_time = backoff * (2 ** attempt) + random.uniform(0, 0.1)
            time.sleep(sleep_time)
            attempt += 1

    raise RuntimeError(f"LLM request failed after {retries + 1} attempts: {last_exc}")


def _build_prompt(question_text, user_answer, correct_answers):
    return (
        f"Question: {question_text}\n"
        f"Correct answers: {correct_answers}\n"
        f"User answer: {user_answer}\n"
        "Evaluate if the user's answer is correct, partially correct, or incorrect. "
        "Reply in JSON: {score: float (0-1), verdict: string, llm_feedback: string}"
    )


def _parse_llm_response(response_text):
    import json, re
    try:
        if response_text is None:
            return {"score": 0.0, "verdict": "empty", "llm_feedback": "No response text from model."}
        if not isinstance(response_text, str):
            response_text = str(response_text)
        parsed = json.loads(response_text)
        score = float(parsed.get('score', 0.0)) if isinstance(parsed.get('score', 0.0), (int, float, str)) else 0.0
        try:
            score = float(score)
        except Exception:
            score = 0.0
        score = max(0.0, min(1.0, score))
        return {
            "score": score,
            "verdict": parsed.get('verdict', ''),
            "llm_feedback": parsed.get('llm_feedback', ''),
        }
    except Exception:
        match = re.search(r'\{.*\}', response_text, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group(0))
                score = float(parsed.get('score', 0.0)) if isinstance(parsed.get('score', 0.0), (int, float, str)) else 0.0
                try:
                    score = float(score)
                except Exception:
                    score = 0.0
                score = max(0.0, min(1.0, score))
                return {
                    "score": score,
                    "verdict": parsed.get('verdict', ''),
                    "llm_feedback": parsed.get('llm_feedback', ''),
                }
            except Exception:
                pass
        return {"score": 0.0, "verdict": "unparseable", "llm_feedback": response_text}
