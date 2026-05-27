"""
Dry-run recovery planner for legacy QuizParty data.

This script is intentionally read-only: it inspects a v2.6 single-tenant
QuizParty directory, matches score files to archived question banks, and writes
human-reviewable reports. It does not connect to or write to PostgreSQL.

The recovery problem is stricter than the standard migration because older
score archives may not embed the full question snapshot. A score file is only
considered importable when the matching question bank has the same question
count and the matched questions have compatible types.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import statistics
import string
import unicodedata
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

import bcrypt
import commentjson
import psycopg
from dotenv import load_dotenv


@dataclass
class QuestionBank:
    path: str
    name: str
    title: str
    mtime: str
    question_count: int
    questions: list[dict[str, Any]]


@dataclass
class ScoreFileReport:
    path: str
    name: str
    mtime: str
    entry_count: int
    answer_counts: dict[str, int]
    uniform_answer_count: int | None
    has_embedded_snapshots: bool
    best_candidate: dict[str, Any] | None
    candidates: list[dict[str, Any]]
    decision: str
    reasons: list[str]


def load_jsonc(path: Path) -> Any:
    return commentjson.loads(path.read_text('utf-8'))


def normalize_text(value: Any) -> str:
    text = '' if value is None else str(value)
    text = unicodedata.normalize('NFKC', text).lower().strip()
    text = re.sub(r'\s+', ' ', text)
    text = re.sub(r'[“”"\'`´]', '', text)
    text = re.sub(r'[^\w\sàèéìòùç]', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def slug_tokens(value: str) -> set[str]:
    return {t for t in re.split(r'[^a-z0-9àèéìòùç]+', normalize_text(value)) if len(t) >= 3}


def parse_time(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()


def parse_timestamp(value: Any, fallback: datetime) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except Exception:
            return fallback
    return fallback


def slugify(text: str) -> str:
    text = normalize_text(text)
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_-]+', '-', text)
    return text.strip('-') or 'quiz'


def generate_temp_password(length: int = 14) -> str:
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


def current_academic_year() -> str:
    now = datetime.now(timezone.utc)
    return f'{now.year}-{now.year + 1}' if now.month >= 9 else f'{now.year - 1}-{now.year}'


def academic_year_for_group(group: str | None) -> str:
    if group:
        match = re.search(r'(20\d{2})\s*-\s*(20\d{2})', group)
        if match:
            return f'{match.group(1)}-{match.group(2)}'
    return current_academic_year()


def question_type(question: dict[str, Any]) -> str | None:
    qtype = question.get('type')
    if qtype in {'single', 'multiple', 'open'}:
        return qtype
    options = question.get('options') or []
    if question.get('acceptable') is not None:
        return 'open'
    correct = question.get('correct')
    if isinstance(correct, list) and options:
        return 'multiple'
    if options:
        return 'single'
    return None


def answer_type(answer: dict[str, Any]) -> str | None:
    explicit = answer.get('type')
    if explicit in {'single', 'multiple', 'open'}:
        return explicit

    snapshot = answer.get('question_snapshot')
    if isinstance(snapshot, dict):
        snap_type = question_type(snapshot)
        if snap_type:
            return snap_type

    for key in ('raw_student_answer', 'raw_correct_answer', 'student_answer', 'correct_answer'):
        val = answer.get(key)
        if isinstance(val, list):
            return 'multiple'

    formatted = f"{answer.get('student_answer', '')} {answer.get('correct_answer', '')}"
    if '(Index:' in formatted or '(index:' in formatted.lower():
        return 'single'

    # Old open answers are stored as free text without formatted option indexes.
    return 'open'


def load_question_banks(source: Path) -> list[QuestionBank]:
    files: list[Path] = []
    active = source / 'questions.jsonc'
    if active.exists():
        files.append(active)
    qbank_dir = source / 'banks' / 'question_bank'
    if qbank_dir.is_dir():
        files.extend(sorted(qbank_dir.glob('*.jsonc')))

    banks: list[QuestionBank] = []
    seen: set[Path] = set()
    for path in files:
        if path in seen or path.name.endswith('.lock'):
            continue
        seen.add(path)
        try:
            data = load_jsonc(path)
        except Exception as exc:
            print(f"WARN: cannot parse question bank {path}: {exc}")
            continue
        if not isinstance(data, dict):
            continue
        questions = data.get('questions') or []
        if not isinstance(questions, list) or not questions:
            continue
        banks.append(QuestionBank(
            path=str(path),
            name=path.name,
            title=str(data.get('title') or path.stem),
            mtime=parse_time(path),
            question_count=len(questions),
            questions=questions,
        ))
    return banks


def load_score_files(source: Path) -> list[Path]:
    files: list[Path] = []
    active = source / 'scores.jsonc'
    if active.exists():
        files.append(active)
    sbank = source / 'banks' / 'scores_bank'
    if sbank.is_dir():
        files.extend(sorted(sbank.glob('*.jsonc')))
    return [p for p in files if not p.name.endswith('.lock')]


def score_rows(path: Path) -> list[dict[str, Any]]:
    data = load_jsonc(path)
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    if isinstance(data, dict):
        for key in ('scores', 'results', 'entries'):
            rows = data.get(key)
            if isinstance(rows, list):
                return [r for r in rows if isinstance(r, dict)]
    return []


def title_similarity(score_path: Path, bank: QuestionBank) -> float:
    score_tokens = slug_tokens(score_path.stem.replace('risultati', ''))
    bank_tokens = slug_tokens(bank.title + ' ' + Path(bank.path).stem)
    if not score_tokens or not bank_tokens:
        return 0.0
    return len(score_tokens & bank_tokens) / len(score_tokens | bank_tokens)


def build_question_match_map(answers: list[dict[str, Any]], bank: QuestionBank) -> tuple[dict[int, dict[str, Any]], dict[str, Any]]:
    questions = bank.questions
    by_id = {str(q.get('id')): q for q in questions if q.get('id') is not None}
    by_text = {normalize_text(q.get('text')): q for q in questions if q.get('text')}
    used_ids: set[str] = set()
    mapping: dict[int, dict[str, Any]] = {}

    matched = 0
    id_matches = 0
    exact_text_matches = 0
    fuzzy_text_matches = 0
    type_mismatches = 0
    unmatched: list[dict[str, Any]] = []

    for idx, answer in enumerate(answers):
        q: dict[str, Any] | None = None
        method = None
        qid = answer.get('question_id')
        if qid is not None and str(qid) in by_id:
            q = by_id[str(qid)]
            method = 'id'
            id_matches += 1

        answer_text_norm = normalize_text(answer.get('question_text'))
        if q is None and answer_text_norm in by_text:
            q = by_text[answer_text_norm]
            method = 'text'
            exact_text_matches += 1

        if q is None and answer_text_norm:
            best_q = None
            best_ratio = 0.0
            for candidate in questions:
                candidate_id = str(candidate.get('id'))
                if candidate_id in used_ids:
                    continue
                ratio = SequenceMatcher(None, answer_text_norm, normalize_text(candidate.get('text'))).ratio()
                if ratio > best_ratio:
                    best_ratio = ratio
                    best_q = candidate
            if best_q is not None and best_ratio >= 0.94:
                q = best_q
                method = 'fuzzy_text'
                fuzzy_text_matches += 1

        if q is None:
            unmatched.append({'index': idx, 'question_id': qid, 'reason': 'no_question_match'})
            continue

        qid_key = str(q.get('id'))
        if qid_key in used_ids:
            unmatched.append({'index': idx, 'question_id': qid, 'reason': 'duplicate_question_match'})
            continue
        used_ids.add(qid_key)

        a_type = answer_type(answer)
        q_type = question_type(q)
        if a_type and q_type and a_type != q_type:
            type_mismatches += 1
            unmatched.append({
                'index': idx,
                'question_id': qid,
                'matched_question_id': q.get('id'),
                'reason': f'type_mismatch:{a_type}!={q_type}',
                'method': method,
            })
            continue

        mapping[idx] = q
        matched += 1

    total = len(answers)
    stats = {
        'total': total,
        'matched': matched,
        'match_ratio': matched / total if total else 0,
        'id_matches': id_matches,
        'exact_text_matches': exact_text_matches,
        'fuzzy_text_matches': fuzzy_text_matches,
        'type_mismatches': type_mismatches,
        'unmatched_count': len(unmatched),
        'unmatched_examples': unmatched[:5],
    }
    return mapping, stats


def match_one_entry(answers: list[dict[str, Any]], bank: QuestionBank) -> dict[str, Any]:
    _, stats = build_question_match_map(answers, bank)
    return stats


def evaluate_candidate(score_path: Path, rows: list[dict[str, Any]], answer_count: int | None, bank: QuestionBank) -> dict[str, Any]:
    count_match = answer_count is not None and answer_count == bank.question_count
    if not count_match:
        return {
            'question_bank': bank.name,
            'question_bank_path': bank.path,
            'title': bank.title,
            'question_count': bank.question_count,
            'count_match': False,
            'confidence': 0,
            'decision': 'reject',
            'reason': f'question_count_mismatch: scores={answer_count}, bank={bank.question_count}',
            'title_similarity': title_similarity(score_path, bank),
        }

    entry_results = []
    for row in rows:
        answers = row.get('answers') or []
        if isinstance(answers, list):
            entry_results.append(match_one_entry([a for a in answers if isinstance(a, dict)], bank))

    if not entry_results:
        confidence = 0.0
        min_match_ratio = 0.0
        avg_match_ratio = 0.0
        total_type_mismatches = 0
        total_unmatched = 0
    else:
        ratios = [r['match_ratio'] for r in entry_results]
        min_match_ratio = min(ratios)
        avg_match_ratio = statistics.mean(ratios)
        total_type_mismatches = sum(r['type_mismatches'] for r in entry_results)
        total_unmatched = sum(r['unmatched_count'] for r in entry_results)
        confidence = min_match_ratio

    decision = 'importable' if confidence == 1.0 and total_type_mismatches == 0 and total_unmatched == 0 else 'manual_review'
    return {
        'question_bank': bank.name,
        'question_bank_path': bank.path,
        'title': bank.title,
        'question_count': bank.question_count,
        'count_match': True,
        'entry_count_checked': len(entry_results),
        'min_match_ratio': round(min_match_ratio, 4),
        'avg_match_ratio': round(avg_match_ratio, 4),
        'total_type_mismatches': total_type_mismatches,
        'total_unmatched': total_unmatched,
        'title_similarity': round(title_similarity(score_path, bank), 4),
        'confidence': round(confidence, 4),
        'decision': decision,
        'sample_unmatched': next((r['unmatched_examples'] for r in entry_results if r['unmatched_examples']), []),
    }


def analyse_score_file(path: Path, banks: list[QuestionBank]) -> ScoreFileReport:
    try:
        rows = score_rows(path)
    except Exception as exc:
        return ScoreFileReport(
            path=str(path), name=path.name, mtime=parse_time(path), entry_count=0,
            answer_counts={}, uniform_answer_count=None, has_embedded_snapshots=False,
            best_candidate=None, candidates=[], decision='parse_error', reasons=[str(exc)],
        )

    counts = Counter()
    embedded = False
    for row in rows:
        answers = row.get('answers') or []
        if isinstance(answers, list):
            counts[str(len(answers))] += 1
            if any(isinstance(a, dict) and isinstance(a.get('question_snapshot'), dict) for a in answers):
                embedded = True

    uniform_answer_count = None
    reasons: list[str] = []
    if not rows:
        reasons.append('no_score_entries')
    elif len(counts) == 1:
        uniform_answer_count = int(next(iter(counts)))
    else:
        reasons.append(f'non_uniform_answer_counts:{dict(counts)}')

    # Strict first gate: question count must match.  Do not run expensive
    # per-answer matching against banks with a different number of questions.
    if uniform_answer_count is None:
        count_compatible_banks: list[QuestionBank] = []
    else:
        count_compatible_banks = [bank for bank in banks if bank.question_count == uniform_answer_count]

    if count_compatible_banks:
        candidates = [evaluate_candidate(path, rows, uniform_answer_count, bank) for bank in count_compatible_banks]
    else:
        # Cheap rejected candidates for report context only.
        candidates = [evaluate_candidate(path, rows, uniform_answer_count, bank) for bank in banks[:20]]

    candidates.sort(key=lambda c: (c.get('confidence', 0), c.get('title_similarity', 0), c.get('count_match', False)), reverse=True)
    top = candidates[:5]
    best = top[0] if top else None

    if best is None:
        decision = 'manual_review'
        reasons.append('no_question_banks_available')
    elif best.get('decision') == 'importable':
        decision = 'importable'
    else:
        decision = 'manual_review'
        if uniform_answer_count is None:
            pass
        elif not best.get('count_match'):
            reasons.append('no_candidate_with_same_question_count')
        else:
            reasons.append('best_candidate_has_unmatched_or_type_mismatches')

    return ScoreFileReport(
        path=str(path),
        name=path.name,
        mtime=parse_time(path),
        entry_count=len(rows),
        answer_counts=dict(counts),
        uniform_answer_count=uniform_answer_count,
        has_embedded_snapshots=embedded,
        best_candidate=best,
        candidates=top,
        decision=decision,
        reasons=reasons,
    )


def student_entries_from_file(path: Path) -> list[tuple[str, str | None]]:
    try:
        data = load_jsonc(path)
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    entries: list[tuple[str, str | None]] = []
    for item in data:
        if isinstance(item, str):
            entries.append((item.strip().lower(), None))
        elif isinstance(item, dict):
            group = item.get('group')
            if item.get('email'):
                entries.append((str(item['email']).strip().lower(), group))
            for email in item.get('emails') or []:
                entries.append((str(email).strip().lower(), group))
    return [(email, group) for email, group in entries if email]


def ensure_teacher(conn, email: str, display_name: str, role: str, temp_passwords: dict[str, str]) -> int:
    existing = conn.execute('SELECT id FROM teachers WHERE email = %s', (email,)).fetchone()
    if existing:
        return existing[0]
    temp_pw = generate_temp_password()
    temp_passwords[email] = temp_pw
    pw_hash = bcrypt.hashpw(temp_pw.encode(), bcrypt.gensalt(rounds=12)).decode()
    row = conn.execute(
        """INSERT INTO teachers (email, display_name, role, password_hash, password_must_change, status)
           VALUES (%s, %s, %s, %s, true, 'active') RETURNING id""",
        (email, display_name, role, pw_hash),
    ).fetchone()
    return row[0]


def ensure_student(conn, email: str, student_email_to_id: dict[str, int]) -> int:
    email = email.strip().lower()
    if email in student_email_to_id:
        return student_email_to_id[email]
    existing = conn.execute('SELECT id FROM students WHERE email = %s', (email,)).fetchone()
    if existing:
        student_email_to_id[email] = existing[0]
        return existing[0]
    display_name = email.split('@')[0].replace('.', ' ').title()
    row = conn.execute(
        "INSERT INTO students (email, display_name, status) VALUES (%s, %s, 'active') RETURNING id",
        (email, display_name),
    ).fetchone()
    student_email_to_id[email] = row[0]
    return row[0]


def ensure_class(conn, group: str, class_name_to_id: dict[tuple[str, str], int]) -> int:
    academic_year = academic_year_for_group(group)
    key = (group, academic_year)
    if key in class_name_to_id:
        return class_name_to_id[key]
    row = conn.execute(
        """INSERT INTO classes (name, academic_year)
           VALUES (%s, %s)
           ON CONFLICT (name, academic_year) DO UPDATE SET name = EXCLUDED.name
           RETURNING id""",
        (group, academic_year),
    ).fetchone()
    class_name_to_id[key] = row[0]
    return row[0]


def insert_snapshot(
    conn,
    *,
    teacher_id: int,
    title: str,
    questions: list[dict[str, Any]],
    created_at: datetime,
) -> int:
    slug_base = slugify(title)
    slug = slug_base
    idx = 1
    while conn.execute('SELECT 1 FROM question_snapshots WHERE teacher_id = %s AND slug = %s', (teacher_id, slug)).fetchone():
        idx += 1
        slug = f'{slug_base}-{idx}'
    row = conn.execute(
        """INSERT INTO question_snapshots (teacher_id, title, slug, content, created_at, updated_at)
           VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
        (teacher_id, title, slug, json.dumps({'questions': questions}, ensure_ascii=False), created_at, created_at),
    ).fetchone()
    return row[0]


def embedded_questions_from_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build the exact session snapshot from embedded answer snapshots.

    Quiz questions are randomized per student, so rows may have different order.
    Use the first complete row as canonical order, but validate other rows by
    question identity (id/text), not by position.
    """
    canonical: list[dict[str, Any]] | None = None
    canonical_by_key: dict[str, dict[str, Any]] | None = None

    for row in rows:
        answers = row.get('answers') or []
        if not isinstance(answers, list) or not answers:
            continue
        snapshots: list[dict[str, Any]] = []
        by_key: dict[str, dict[str, Any]] = {}
        complete = True
        for answer in answers:
            if not isinstance(answer, dict) or not isinstance(answer.get('question_snapshot'), dict):
                complete = False
                break
            q = dict(answer['question_snapshot'])
            q.setdefault('id', answer.get('question_id'))
            q.setdefault('text', answer.get('question_text'))
            q_type = question_type(q) or answer_type(answer)
            if q_type:
                q['type'] = q_type
            key = str(q.get('id')) if q.get('id') is not None else normalize_text(q.get('text'))
            if key in by_key:
                raise RuntimeError(f'Duplicate embedded question key: {key}')
            by_key[key] = q
            snapshots.append(q)
        if complete:
            canonical = snapshots
            canonical_by_key = by_key
            break

    if canonical is None or canonical_by_key is None:
        raise RuntimeError('No complete embedded question_snapshot set found.')

    expected_count = len(canonical)
    expected_keys = set(canonical_by_key.keys())
    for row in rows:
        answers = row.get('answers') or []
        if not isinstance(answers, list) or len(answers) != expected_count:
            raise RuntimeError('Embedded score rows do not have a uniform question count.')
        row_keys: set[str] = set()
        for answer in answers:
            if not isinstance(answer, dict) or not isinstance(answer.get('question_snapshot'), dict):
                raise RuntimeError('Embedded score row is missing a question_snapshot.')
            q = answer['question_snapshot']
            key = str(q.get('id')) if q.get('id') is not None else normalize_text(q.get('text'))
            row_keys.add(key)
            canonical_q = canonical_by_key.get(key)
            if canonical_q is None:
                raise RuntimeError(f'Embedded row contains unexpected question: {key}')
            c_type = question_type(canonical_q)
            q_type = question_type(q) or answer_type(answer)
            if c_type and q_type and c_type != q_type:
                raise RuntimeError(f'Embedded type mismatch for question {key}: {q_type}!={c_type}')
        if row_keys != expected_keys:
            missing = sorted(expected_keys - row_keys)[:5]
            extra = sorted(row_keys - expected_keys)[:5]
            raise RuntimeError(f'Embedded question identity differs between score rows; missing={missing}, extra={extra}')

    return canonical


def copy_bank_images(bank_path: Path, source: Path, teacher_id: int, snapshot_id: int, images_base: Path) -> int:
    if bank_path.name == 'questions.jsonc':
        candidates = [source / 'images', source / 'banks' / 'question_bank' / 'questions_images']
    else:
        candidates = [bank_path.parent / f'{bank_path.stem}_images']
    copied = 0
    dest = images_base / str(teacher_id) / str(snapshot_id)
    for src_dir in candidates:
        if not src_dir.is_dir():
            continue
        dest.mkdir(parents=True, exist_ok=True)
        for item in src_dir.iterdir():
            if item.is_file():
                shutil.copy2(item, dest / item.name)
                copied += 1
    return copied


def enrich_answers(answers: list[dict[str, Any]], bank: QuestionBank) -> list[dict[str, Any]]:
    mapping, stats = build_question_match_map(answers, bank)
    if stats['matched'] != len(answers) or stats['type_mismatches']:
        raise RuntimeError(f"Refusing to enrich unmatched answers for {bank.name}: {stats}")
    enriched: list[dict[str, Any]] = []
    for idx, answer in enumerate(answers):
        q = mapping[idx]
        item = dict(answer)
        q_type = question_type(q)
        item.setdefault('type', q_type)
        item['question_snapshot'] = item.get('question_snapshot') if isinstance(item.get('question_snapshot'), dict) else q
        item.setdefault('question_id', q.get('id'))
        item.setdefault('question_text', q.get('text'))
        item.setdefault('question_image', q.get('question_image'))
        item.setdefault('weight', q.get('weight', 1))
        item.setdefault('points_awarded', 0)
        item.setdefault('raw_points', item.get('points_awarded', 0))
        enriched.append(item)
    return enriched


def apply_recovery(source: Path, report_path: Path, teacher_email: str, super_admin_email: str, images_base: Path) -> dict[str, Any]:
    load_dotenv(Path(__file__).resolve().parents[1] / '.env')
    dsn = os.environ.get('DATABASE_URL') or 'postgresql:///quizparty'
    if dsn.endswith(':///quizparty') and not os.environ.get('DATABASE_URL'):
        raise RuntimeError('DATABASE_URL is not set; run inside the Docker app container or set DATABASE_URL explicitly.')

    report = json.loads(report_path.read_text('utf-8'))
    banks = {bank.path: bank for bank in load_question_banks(source)}
    score_reports = report['score_reports']
    importable = [r for r in score_reports if r['decision'] == 'importable']

    counters: dict[str, Any] = defaultdict(int)
    temp_passwords: dict[str, str] = {}
    student_email_to_id: dict[str, int] = {}
    student_classes: dict[str, set[int]] = defaultdict(set)
    class_name_to_id: dict[tuple[str, str], int] = {}
    snapshot_by_bank_path: dict[str, int] = {}

    with psycopg.connect(dsn) as conn:
        existing_scores = conn.execute('SELECT COUNT(*) FROM score_entries').fetchone()[0]
        existing_plans = conn.execute('SELECT COUNT(*) FROM quiz_plans').fetchone()[0]
        if existing_scores or existing_plans:
            raise RuntimeError('Target DB already has score_entries or quiz_plans; refusing to apply recovery.')

        super_admin_id = ensure_teacher(conn, super_admin_email, 'Webmaster', 'super_admin', temp_passwords)
        teacher_id = ensure_teacher(conn, teacher_email, 'Mauro Longano', 'teacher', temp_passwords)
        counters['teachers'] = 2
        counters['super_admin_id'] = super_admin_id
        counters['teacher_id'] = teacher_id

        # Students/classes from active and archived student lists.
        student_files = []
        if (source / 'students.jsonc').exists():
            student_files.append(source / 'students.jsonc')
        student_files.extend(sorted((source / 'banks' / 'students_bank').glob('*.jsonc')) if (source / 'banks' / 'students_bank').is_dir() else [])
        for student_file in student_files:
            for email, group in student_entries_from_file(student_file):
                if email in {teacher_email, super_admin_email} or normalize_text(group) in {'theacher', 'teacher', 'docente'}:
                    continue
                student_id = ensure_student(conn, email, student_email_to_id)
                counters['students_seen'] += 1
                if group:
                    class_id = ensure_class(conn, group, class_name_to_id)
                    conn.execute('INSERT INTO class_teachers (class_id, teacher_id) VALUES (%s, %s) ON CONFLICT DO NOTHING', (class_id, teacher_id))
                    conn.execute('INSERT INTO class_students (class_id, student_id) VALUES (%s, %s) ON CONFLICT DO NOTHING', (class_id, student_id))
                    student_classes[email].add(class_id)

        counters['students'] = len(student_email_to_id)
        counters['classes'] = len(class_name_to_id)

        # Import every question bank, so teachers retain the complete bank archive.
        for bank_path_str, bank in banks.items():
            bank_path = Path(bank_path_str)
            mtime = datetime.fromisoformat(bank.mtime)
            snapshot_id = insert_snapshot(
                conn,
                teacher_id=teacher_id,
                title=bank.title,
                questions=bank.questions,
                created_at=mtime,
            )
            snapshot_by_bank_path[bank_path_str] = snapshot_id
            counters['snapshots'] += 1
            copied = copy_bank_images(bank_path, source, teacher_id, snapshot_id, images_base)
            counters['images_copied'] += copied

        # Import importable score files as closed sessions + score entries.
        for r in importable:
            score_path = Path(r['path'])
            bank_path_str = r['best_candidate']['question_bank_path']
            bank = banks[bank_path_str]
            rows = score_rows(score_path)
            fallback_time = datetime.fromisoformat(parse_time(score_path))
            if r.get('has_embedded_snapshots'):
                embedded_questions = embedded_questions_from_rows(rows)
                snapshot_id = insert_snapshot(
                    conn,
                    teacher_id=teacher_id,
                    title=f"{score_path.stem} — snapshot sessione",
                    questions=embedded_questions,
                    created_at=fallback_time,
                )
                counters['embedded_session_snapshots'] += 1
                counters['snapshots'] += 1
                bank = QuestionBank(
                    path=f"embedded:{score_path}",
                    name=f"embedded:{score_path.name}",
                    title=f"{score_path.stem} — snapshot sessione",
                    mtime=fallback_time.isoformat(),
                    question_count=len(embedded_questions),
                    questions=embedded_questions,
                )
            else:
                snapshot_id = snapshot_by_bank_path[bank_path_str]
            submitted_times = [parse_timestamp(row.get('timestamp'), fallback_time) for row in rows]
            created_at = min(submitted_times) if submitted_times else fallback_time
            session_title = score_path.stem
            row = conn.execute(
                """INSERT INTO quiz_sessions (teacher_id, snapshot_id, title, status, created_at)
                   VALUES (%s, %s, %s, 'closed', %s) RETURNING id""",
                (teacher_id, snapshot_id, session_title, created_at),
            ).fetchone()
            session_id = row[0]
            counters['sessions'] += 1

            session_class_ids: set[int] = set()
            for score_row in rows:
                email = str(score_row.get('student') or '').strip().lower()
                if not email:
                    continue
                student_id = ensure_student(conn, email, student_email_to_id)
                session_class_ids.update(student_classes.get(email, set()))
                answers = score_row.get('answers') or []
                if not isinstance(answers, list):
                    answers = []
                enriched = enrich_answers([a for a in answers if isinstance(a, dict)], bank)
                submitted_at = parse_timestamp(score_row.get('timestamp'), fallback_time)
                conn.execute(
                    """INSERT INTO score_entries
                           (session_id, student_id, teacher_id, raw_points, max_points, percent, answers, submitted_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT (session_id, student_id) DO NOTHING""",
                    (
                        session_id,
                        student_id,
                        teacher_id,
                        score_row.get('raw_points', 0),
                        score_row.get('max_points', 0),
                        score_row.get('percent', 0),
                        json.dumps(enriched, ensure_ascii=False),
                        submitted_at,
                    ),
                )
                counters['score_entries'] += 1

            for class_id in session_class_ids:
                conn.execute('INSERT INTO session_classes (session_id, class_id) VALUES (%s, %s) ON CONFLICT DO NOTHING', (session_id, class_id))

        # Preserve raw score files as archives, including manual-review ones.
        for r in score_reports:
            score_path = Path(r['path'])
            try:
                raw_content = load_jsonc(score_path)
            except Exception:
                continue
            archived_at = datetime.fromisoformat(parse_time(score_path))
            matching_session_id = None
            conn.execute(
                """INSERT INTO score_archives (teacher_id, title, source_session_id, content, notes, archived_at)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (
                    teacher_id,
                    score_path.stem,
                    matching_session_id,
                    json.dumps(raw_content, ensure_ascii=False),
                    f"Recovery decision: {r['decision']}; reasons: {', '.join(r.get('reasons') or [])}",
                    archived_at,
                ),
            )
            counters['score_archives'] += 1

        conn.commit()

    counters['temp_passwords'] = temp_passwords
    counters['imported_score_files'] = len(importable)
    counters['manual_review_score_files'] = len(score_reports) - len(importable)
    return dict(counters)


def write_reports(out_dir: Path, reports: list[ScoreFileReport], banks: list[QuestionBank], source: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'source': str(source),
        'question_banks': [
            {k: v for k, v in asdict(bank).items() if k != 'questions'}
            for bank in banks
        ],
        'score_reports': [asdict(r) for r in reports],
    }
    (out_dir / 'legacy_recovery_report.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2), 'utf-8')

    lines = [
        '# Legacy QuizParty recovery dry-run',
        '',
        f'- Source: `{source}`',
        f'- Question banks: {len(banks)}',
        f'- Score files: {len(reports)}',
        '',
        '## Summary',
        '',
        '| Decision | Count |',
        '|---|---:|',
    ]
    decisions = Counter(r.decision for r in reports)
    for decision, count in sorted(decisions.items()):
        lines.append(f'| {decision} | {count} |')

    lines.extend(['', '## Score file matches', ''])
    lines.append('| Score file | Entries | Answers | Embedded snapshots | Decision | Best question bank | Confidence | Reasons |')
    lines.append('|---|---:|---:|---|---|---|---:|---|')
    for r in reports:
        best = r.best_candidate or {}
        reasons = '<br>'.join(r.reasons) if r.reasons else ''
        lines.append(
            f"| `{r.name}` | {r.entry_count} | {r.uniform_answer_count or '-'} | "
            f"{'yes' if r.has_embedded_snapshots else 'no'} | {r.decision} | "
            f"`{best.get('question_bank', '-')}` | {best.get('confidence', 0)} | {reasons} |"
        )

    lines.extend(['', '## Manual review details', ''])
    for r in reports:
        if r.decision == 'importable':
            continue
        lines.append(f'### {r.name}')
        lines.append('')
        lines.append(f'- Reasons: {", ".join(r.reasons) if r.reasons else "n/a"}')
        for c in r.candidates[:3]:
            lines.append(
                f"- Candidate `{c.get('question_bank')}`: confidence={c.get('confidence')}, "
                f"count_match={c.get('count_match')}, min_match={c.get('min_match_ratio', '-')}, "
                f"type_mismatches={c.get('total_type_mismatches', '-')}, unmatched={c.get('total_unmatched', '-')}, "
                f"title_similarity={c.get('title_similarity', '-')}"
            )
        lines.append('')

    (out_dir / 'legacy_recovery_report.md').write_text('\n'.join(lines) + '\n', 'utf-8')


def main() -> None:
    parser = argparse.ArgumentParser(description='Dry-run/apply legacy QuizParty recovery matching')
    parser.add_argument('--source', default='/srv/QuizParty', help='Legacy QuizParty root')
    parser.add_argument('--out-dir', default='/srv/QuizPartyPlatform/recovery_reports', help='Report output directory')
    parser.add_argument('--teacher-email', default='mauro.longano@marconirovereto.it')
    parser.add_argument('--super-admin-email', default='webmaster@marconirovereto.it')
    parser.add_argument('--images-base', default='/app/images', help='Target image base directory when applying')
    parser.add_argument('--apply', action='store_true', help='Write importable rows to the target database')
    args = parser.parse_args()

    source = Path(args.source).resolve()
    out_dir = Path(args.out_dir).resolve()

    banks = load_question_banks(source)
    score_paths = load_score_files(source)
    reports = [analyse_score_file(path, banks) for path in score_paths]
    write_reports(out_dir, reports, banks, source)

    decisions = Counter(r.decision for r in reports)
    print('Legacy recovery dry-run complete (read-only).')
    print(f'Source: {source}')
    print(f'Teacher owner: {args.teacher_email}')
    print(f'Super-admin: {args.super_admin_email}')
    print(f'Question banks: {len(banks)}')
    print(f'Score files: {len(reports)}')
    for decision, count in sorted(decisions.items()):
        print(f'  {decision}: {count}')
    print(f'Reports:')
    print(f'  {out_dir / "legacy_recovery_report.md"}')
    print(f'  {out_dir / "legacy_recovery_report.json"}')

    if args.apply:
        print()
        print('Applying importable recovery rows to the database...')
        summary = apply_recovery(
            source,
            out_dir / 'legacy_recovery_report.json',
            args.teacher_email.strip().lower(),
            args.super_admin_email.strip().lower(),
            Path(args.images_base),
        )
        apply_report = out_dir / 'legacy_recovery_apply_summary.json'
        apply_report.write_text(json.dumps(summary, ensure_ascii=False, indent=2), 'utf-8')
        print('Apply complete.')
        for key in sorted(k for k in summary.keys() if k != 'temp_passwords'):
            print(f'  {key}: {summary[key]}')
        if summary.get('temp_passwords'):
            print('Temporary passwords:')
            for email, password in summary['temp_passwords'].items():
                print(f'  {email}: {password}')
        print(f'Apply summary: {apply_report}')


if __name__ == '__main__':
    main()
