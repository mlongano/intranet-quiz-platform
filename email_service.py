"""
Email service for sending quiz results to students.
Uses Gmail SMTP with Google Workspace credentials.
"""

import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
import re
from typing import Optional

# Load email configuration from environment
EMAIL_SENDER = os.getenv('EMAIL_SENDER', '')
EMAIL_PASSWORD = os.getenv('EMAIL_PASSWORD', '')
SMTP_SERVER = os.getenv('SMTP_SERVER', 'smtp.gmail.com')
SMTP_PORT = int(os.getenv('SMTP_PORT', '587'))


def is_valid_email(email: str) -> bool:
    """Validate email format."""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))


def format_quiz_results_html(submission: dict) -> str:
    """
    Format quiz submission data as HTML email content.

    Args:
        submission: Score entry dict with student, quiz_id, answers, raw_points, etc.

    Returns:
        HTML string for email body
    """
    student = submission.get('student', 'Student')
    quiz_id = submission.get('quiz_id', 'N/A')
    raw_points = submission.get('raw_points', 0)
    max_points = submission.get('max_points', 0)
    percent = submission.get('percent', 0)
    timestamp = submission.get('timestamp', '')
    answers = submission.get('answers', [])

    # Format timestamp
    try:
        dt = datetime.fromisoformat(timestamp)
        formatted_time = dt.strftime('%d/%m/%Y %H:%M:%S')
    except:
        formatted_time = timestamp

    # Build HTML
    html = f"""
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .header {{ background-color: #4CAF50; color: white; padding: 20px; text-align: center; }}
            .summary {{ background-color: #f4f4f4; padding: 15px; margin: 20px 0; border-radius: 5px; }}
            .question {{ margin: 20px 0; padding: 15px; border-left: 4px solid #2196F3; background-color: #f9f9f9; }}
            .correct {{ color: #4CAF50; font-weight: bold; }}
            .incorrect {{ color: #f44336; font-weight: bold; }}
            .partial {{ color: #FF9800; font-weight: bold; }}
            .answer {{ margin: 10px 0; padding: 10px; background-color: white; border-radius: 3px; }}
            .footer {{ margin-top: 30px; padding: 20px; background-color: #f4f4f4; text-align: center; font-size: 0.9em; }}
        </style>
    </head>
    <body>
        <div class="header">
            <h1>Quiz Results</h1>
        </div>

        <div class="summary">
            <h2>Summary</h2>
            <p><strong>Student:</strong> {student}</p>
            <p><strong>Quiz ID:</strong> {quiz_id}</p>
            <p><strong>Submission Date:</strong> {formatted_time}</p>
            <p><strong>Score:</strong> {raw_points} / {max_points} ({percent}%)</p>
        </div>

        <h2>Detailed Results</h2>
    """

    # Add each question
    for idx, answer in enumerate(answers, 1):
        q_text = answer.get('question_text', 'Question')
        student_ans = answer.get('student_answer', 'No answer')
        correct_ans = answer.get('correct_answer', 'N/A')
        points = answer.get('points_awarded', 0)
        weight = answer.get('weight', 1)

        # Determine if answer is correct, incorrect, or partial
        if points == 0:
            status_class = 'incorrect'
            status_text = '✗ Incorrect'
        elif points >= weight:
            status_class = 'correct'
            status_text = '✓ Correct'
        else:
            status_class = 'partial'
            status_text = '◐ Partial'

        # Format answers (handle lists for multiple choice)
        if isinstance(student_ans, list):
            student_ans_str = '<ul>' + ''.join(f'<li>{ans}</li>' for ans in student_ans) + '</ul>'
        else:
            student_ans_str = str(student_ans)

        if isinstance(correct_ans, list):
            correct_ans_str = '<ul>' + ''.join(f'<li>{ans}</li>' for ans in correct_ans) + '</ul>'
        else:
            correct_ans_str = str(correct_ans)

        html += f"""
        <div class="question">
            <h3>Question {idx}</h3>
            <p><strong>{q_text}</strong></p>

            <div class="answer">
                <p><strong>Your Answer:</strong></p>
                {student_ans_str}
            </div>

            <div class="answer">
                <p><strong>Correct Answer:</strong></p>
                {correct_ans_str}
            </div>

            <p class="{status_class}">
                {status_text} - Score: {points}/{weight} points
            </p>
        </div>
        """

    html += """
        <div class="footer">
            <p>This is an automated message. Please do not reply to this email.</p>
        </div>
    </body>
    </html>
    """

    return html


def send_quiz_result_email(student_email: str, submission: dict) -> tuple[bool, str]:
    """
    Send quiz results to student via email.

    Args:
        student_email: Student's email address
        submission: Score entry dict with quiz results

    Returns:
        Tuple of (success: bool, message: str)
    """
    print(f"[EMAIL] Starting to send email to: {student_email}")

    # Validate configuration
    if not EMAIL_SENDER or not EMAIL_PASSWORD:
        print("[EMAIL] Error: Email service not configured")
        return False, "Email service not configured. Please set EMAIL_SENDER and EMAIL_PASSWORD in .env"

    print(f"[EMAIL] Using SMTP server: {SMTP_SERVER}:{SMTP_PORT}")
    print(f"[EMAIL] Sender: {EMAIL_SENDER}")

    # Validate recipient email
    if not is_valid_email(student_email):
        print(f"[EMAIL] Invalid email format: {student_email}")
        return False, f"Invalid email address: {student_email}"

    try:
        # Create message
        msg = MIMEMultipart('alternative')
        msg['From'] = EMAIL_SENDER
        msg['To'] = student_email
        msg['Subject'] = f"Quiz Results - Score: {submission.get('percent', 0)}%"

        print(f"[EMAIL] Message created with subject: {msg['Subject']}")

        # Generate HTML content
        html_content = format_quiz_results_html(submission)
        html_part = MIMEText(html_content, 'html')
        msg.attach(html_part)

        print(f"[EMAIL] HTML content generated, length: {len(html_content)} chars")

        # Connect to SMTP server and send
        print(f"[EMAIL] Connecting to SMTP server...")
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            print(f"[EMAIL] Starting TLS...")
            server.starttls()  # Enable TLS encryption
            print(f"[EMAIL] Logging in as {EMAIL_SENDER}...")
            server.login(EMAIL_SENDER, EMAIL_PASSWORD)
            print(f"[EMAIL] Sending message...")
            server.send_message(msg)
            print(f"[EMAIL] Message sent successfully!")

        return True, f"Email sent successfully to {student_email}"

    except smtplib.SMTPAuthenticationError as e:
        print(f"[EMAIL] Authentication error: {e}")
        return False, "Email authentication failed. Check EMAIL_SENDER and EMAIL_PASSWORD"
    except smtplib.SMTPException as e:
        print(f"[EMAIL] SMTP error: {e}")
        return False, f"SMTP error: {str(e)}"
    except Exception as e:
        print(f"[EMAIL] Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return False, f"Error sending email: {str(e)}"


def send_bulk_quiz_results(submissions: list[dict]) -> dict:
    """
    Send quiz results to multiple students.

    Args:
        submissions: List of score entry dicts

    Returns:
        Dict with success_count, failed_count, and errors list
    """
    results = {
        'success_count': 0,
        'failed_count': 0,
        'errors': []
    }

    for submission in submissions:
        student_email = submission.get('student', '')

        if not student_email:
            results['failed_count'] += 1
            results['errors'].append('Missing student email')
            continue

        success, message = send_quiz_result_email(student_email, submission)

        if success:
            results['success_count'] += 1
        else:
            results['failed_count'] += 1
            results['errors'].append(f"{student_email}: {message}")

    return results
