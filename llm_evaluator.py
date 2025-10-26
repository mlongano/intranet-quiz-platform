import os
import time
import random
import requests
from requests.exceptions import RequestException

OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"
GOOGLE_GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent"

# Strict system prompt to encourage consistent JSON-only replies and give two short examples
# SYSTEM_PROMPT = (
#     "You are an unbiased quiz grader.\n"
#     "Return JSON only with exactly these keys: {\"score\": float (0-1), \"verdict\": string, \"llm_feedback\": string}.\n"
#     "Score must be 1.0 for full credit, 0.0 for no credit, and fractions for partial credit. Keep llm_feedback shot (<=170 chars).\n"
#     "Examples:\n"
#     "1) Question: 'Capital of France?'; Correct answers: ['Paris']; Student answer: 'Paris' -> {\"score\":1.0,\"verdict\":\"correct\",\"llm_feedback\":\"Exact match\"}\n"
#     "2) Question: 'Name three noble gases.'; Correct answers include ['helium','neon','argon','krypton','xenon','radon']; Student answer: 'helium, neon' -> {\"score\":0.5,\"verdict\":\"partial\",\"llm_feedback\":\"Two valid gases, needs 3\"}\n"
#     "Respond with JSON only and nothing else."
# )

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
    Evaluate an open question using the selected LLM provider.
    Args:
        question_text (str): The question being asked.
        user_answer (str): The answer provided by the user.
        correct_answers (list[str]): List of acceptable/correct answers.
    Returns:
        dict: { 'score': float, 'verdict': str, 'llm_feedback': str }
    """
    provider = os.getenv("LLM_PROVIDER", "openai").lower()
    if provider == "openai":
        return _evaluate_with_openai(question_text, user_answer, correct_answers)
    elif provider == "google":
        return _evaluate_with_google_gemini(question_text, user_answer, correct_answers)
    else:
        raise ValueError(f"Unsupported LLM provider: {provider}")

def _evaluate_with_openai(question_text, user_answer, correct_answers):
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY environment variable not set.")
    # Configurable params
    model = os.getenv("LLM_MODEL", "gpt-3.5-turbo")
    timeout = float(os.getenv("LLM_TIMEOUT_SEC", "10"))
    retries = int(os.getenv("LLM_RETRIES", "2"))
    backoff = float(os.getenv("LLM_BACKOFF_FACTOR", "0.5"))

    prompt = _build_prompt(question_text, user_answer, correct_answers)
    # Use strict system prompt + concise user prompt for reliability
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    data = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt}
        ],
        "max_tokens": 256
    }

    attempt = 0
    last_exc = None
    while attempt <= retries:
        try:
            resp = requests.post(OPENAI_API_URL, headers=headers, json=data, timeout=timeout)
            resp.raise_for_status()
            content = resp.json()
            # Safe access - may raise KeyError which will be handled
            text = content.get("choices", [])[0].get("message", {}).get("content")
            return _parse_llm_response(text)
        except RequestException as e:
            last_exc = e
            # For 4xx errors (except 429) don't retry
            status = None
            try:
                status = getattr(e.response, 'status_code', None)
            except Exception:
                status = None
            if status and 400 <= status < 500 and status != 429:
                raise
            # Sleep with jittered exponential backoff
            sleep_time = backoff * (2 ** attempt) + random.uniform(0, 0.1)
            time.sleep(sleep_time)
            attempt += 1

    # If we exhausted retries, raise the last exception
    raise RuntimeError(f"OpenAI request failed after {retries+1} attempts: {last_exc}")

def _evaluate_with_google_gemini(question_text, user_answer, correct_answers):
    api_key = os.getenv("GOOGLE_GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_GEMINI_API_KEY environment variable not set.")
    prompt = _build_prompt(question_text, user_answer, correct_answers)
    # Prepend the strict system prompt to the user prompt for Gemini
    full_prompt = SYSTEM_PROMPT + "\n\n" + prompt
    timeout = float(os.getenv("LLM_TIMEOUT_SEC", "10"))
    retries = int(os.getenv("LLM_RETRIES", "2"))
    backoff = float(os.getenv("LLM_BACKOFF_FACTOR", "0.5"))

    headers = {"Content-Type": "application/json"}
    data = {
        "contents": [{
            "role": "user",
            "parts": [{"text": full_prompt}]
        }]
    }
    url = f"{GOOGLE_GEMINI_API_URL}?key={api_key}"

    attempt = 0
    last_exc = None
    while attempt <= retries:
        try:
            resp = requests.post(url, headers=headers, json=data, timeout=timeout)
            resp.raise_for_status()
            content = resp.json()
            # Attempt to navigate Gemini response safely
            candidates = content.get('candidates') or []
            if candidates:
                parts = candidates[0].get('content', {}).get('parts') or []
                if parts:
                    return _parse_llm_response(parts[0].get('text'))
            # If format not as expected, fallback to parsing top-level text if present
            text = content.get('output', {}).get('text') or str(content)
            return _parse_llm_response(text)
        except RequestException as e:
            last_exc = e
            status = None
            try:
                status = getattr(e.response, 'status_code', None)
            except Exception:
                status = None
            if status and 400 <= status < 500 and status != 429:
                raise
            sleep_time = backoff * (2 ** attempt) + random.uniform(0, 0.1)
            time.sleep(sleep_time)
            attempt += 1

    raise RuntimeError(f"Google Gemini request failed after {retries+1} attempts: {last_exc}")

def _build_prompt(question_text, user_answer, correct_answers):
    return (
        f"Question: {question_text}\n"
        f"Correct answers: {correct_answers}\n"
        f"User answer: {user_answer}\n"
        "Evaluate if the user's answer is correct, partially correct, or incorrect. "
        "Reply in JSON: {score: float (0-1), verdict: string, llm_feedback: string}"
    )

def _parse_llm_response(response_text):
    import json
    try:
        # Ensure response_text is a string
        if response_text is None:
            return {"score": 0.0, "verdict": "empty", "llm_feedback": "No response text from model."}
        if not isinstance(response_text, str):
            response_text = str(response_text)
        parsed = json.loads(response_text)
        # Ensure keys exist and score is clamped
        score = float(parsed.get('score', 0.0)) if isinstance(parsed.get('score', 0.0), (int, float, str)) else 0.0
        try:
            score = float(score)
        except Exception:
            score = 0.0
        # Clamp
        score = max(0.0, min(1.0, score))
        verdict = parsed.get('verdict', '')
        llm_feedback = parsed.get('llm_feedback', '')
        return {"score": score, "verdict": verdict, "llm_feedback": llm_feedback}
    except Exception:
        # fallback: try to extract JSON from text
        import re
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
                return {"score": score, "verdict": parsed.get('verdict', ''), "llm_feedback": parsed.get('llm_feedback', '')}
            except Exception:
                pass
        return {"score": 0.0, "verdict": "unparseable", "llm_feedback": response_text}
