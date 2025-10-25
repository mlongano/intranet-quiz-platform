#!/usr/bin/env python3
"""
Backfill option_order in scores.jsonc by reconstructing it from student_answer indices.

For each answer:
- Parse the Index from student_answer (original index)
- Use raw_student_answer (shuffled index)
- Deduce: option_order[raw_student_answer] = original_index
"""

import json
import re
import shutil
from datetime import datetime
from pathlib import Path
import os
import sys

# Add parent directory to path to import commentjson
try:
    import commentjson
except ImportError:
    print("Installing commentjson...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "commentjson"])
    import commentjson

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    print("python-dotenv not found, using default paths")
    pass

SCORE_FILE = os.getenv('SCORE_FILE', './scores.jsonc')

def extract_indices_from_formatted_answer(formatted_answer):
    """Extract original indices from formatted answer strings."""
    if isinstance(formatted_answer, str):
        # Single answer: "'text' (Index: 2)"
        match = re.search(r'\(Index:\s*(\d+)\)', formatted_answer)
        if match:
            return [int(match.group(1))]
        return []
    elif isinstance(formatted_answer, list):
        # Multiple answers: ["'text1' (Index: 2)", "'text2' (Index: 3)"]
        indices = []
        for item in formatted_answer:
            if isinstance(item, str):
                match = re.search(r'\(Index:\s*(\d+)\)', item)
                if match:
                    indices.append(int(match.group(1)))
        return indices
    return []

def reconstruct_option_order(answer_detail, question):
    """
    Reconstruct option_order by mapping shuffled indices to original indices.

    Returns a list where option_order[shuffled_idx] = original_idx
    """
    num_options = len(question.get('options', []))
    option_order = [None] * num_options  # Initialize with None

    raw_student_answer = answer_detail.get('raw_student_answer')
    student_answer = answer_detail.get('student_answer')

    # Extract original indices from formatted answer
    original_indices = extract_indices_from_formatted_answer(student_answer)

    # Map shuffled to original
    if isinstance(raw_student_answer, int):
        # Single choice: raw_student_answer is the shuffled index
        if original_indices:
            option_order[raw_student_answer] = original_indices[0]
    elif isinstance(raw_student_answer, list):
        # Multiple choice: raw_student_answer is list of shuffled indices
        for shuffled_idx, orig_idx in zip(raw_student_answer, original_indices):
            if isinstance(shuffled_idx, int) and 0 <= shuffled_idx < num_options:
                option_order[shuffled_idx] = orig_idx

    # Fill in remaining positions with remaining indices
    # This is an approximation - we can't know the exact order for unchosen options
    used_original_indices = set(idx for idx in option_order if idx is not None)
    remaining_indices = [i for i in range(num_options) if i not in used_original_indices]

    for i in range(len(option_order)):
        if option_order[i] is None and remaining_indices:
            # Fill with remaining indices (order is unknown, but doesn't affect scoring)
            option_order[i] = remaining_indices.pop(0)

    return option_order

def backfill_scores(questions_file='./questions.jsonc'):
    """Backfill option_order in all score entries."""

    # Load questions to get option counts
    print(f"Loading questions from {questions_file}...")
    with open(questions_file, 'r', encoding='utf-8') as f:
        questions = commentjson.load(f)

    question_map = {q['id']: q for q in questions}
    print(f"Loaded {len(questions)} questions")

    # Load scores
    print(f"Loading scores from {SCORE_FILE}...")
    with open(SCORE_FILE, 'r', encoding='utf-8') as f:
        scores = commentjson.load(f)

    print(f"Loaded {len(scores)} submissions")

    # Create backup
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_file = f"{SCORE_FILE}.backup_{timestamp}"
    shutil.copy2(SCORE_FILE, backup_file)
    print(f"Created backup: {backup_file}")

    # Process each submission
    updated_count = 0
    for score_entry in scores:
        student_id = score_entry.get('student', 'unknown')
        has_changes = False

        for answer_detail in score_entry.get('answers', []):
            # Skip if option_order already exists
            if 'option_order' in answer_detail and answer_detail['option_order']:
                continue

            q_id = answer_detail.get('question_id')
            if q_id not in question_map:
                print(f"Warning: Question {q_id} not found in question bank for {student_id}")
                continue

            question = question_map[q_id]
            q_type = question.get('type')

            # Only reconstruct for single/multiple choice questions
            if q_type in ['single', 'multiple']:
                option_order = reconstruct_option_order(answer_detail, question)
                answer_detail['option_order'] = option_order
                has_changes = True

        if has_changes:
            updated_count += 1

    # Save updated scores
    with open(SCORE_FILE, 'w', encoding='utf-8') as f:
        json.dump(scores, f, indent=2, ensure_ascii=False)

    print(f"\nBackfill complete!")
    print(f"Updated {updated_count} submissions")
    print(f"Total submissions: {len(scores)}")
    print(f"Backup saved to: {backup_file}")

if __name__ == '__main__':
    backfill_scores()
