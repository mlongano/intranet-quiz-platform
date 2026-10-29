"""The results-link e-mail, sent from the teacher's own Gmail.

It carries the least it can: that the results of a quiz are available, and the
link to the student's results page — no score, no answer. Everything else is
behind the school Google login on that page.

Sent through the Gmail API as the teacher: the Workspace service account
(GOOGLE_SA_KEY_PATH, the one the Directory and Classroom syncs use) impersonates
them with the ``gmail.send`` scope, which a Workspace administrator must
authorise for the account's client ID under domain-wide delegation. The
server never sends SMTP (tokenator blocks it), and holds no mail password.
"""

from __future__ import annotations

import base64
import os
from email.message import EmailMessage
from email.utils import formataddr

GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.send']


class EmailNotAvailable(Exception):
    """Sending from this teacher's mailbox is not possible; ``code`` for the API."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def results_message(*, teacher_name: str, teacher_email: str, student_email: str,
                    title: str, link: str) -> EmailMessage:
    msg = EmailMessage()
    msg['From'] = formataddr((teacher_name, teacher_email))
    msg['To'] = student_email
    msg['Subject'] = f"Risultati: {title}"
    msg.set_content(
        f"I risultati di «{title}» sono disponibili.\n\n"
        f"Per vederli apri questo link e accedi con il tuo account della scuola:\n"
        f"{link}\n\n"
        f"{teacher_name}\n"
    )
    return msg


def gmail_service(teacher_email: str):
    """A Gmail client acting as *teacher_email*; raises EmailNotAvailable."""
    path = os.environ.get('GOOGLE_SA_KEY_PATH')
    if not path or not os.path.isfile(path):
        raise EmailNotAvailable('EMAIL_NOT_CONFIGURED',
                                "Invio email non configurato: manca l'account di servizio Google.")
    from google.auth.exceptions import RefreshError
    from google.auth.transport.requests import Request
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    creds = service_account.Credentials.from_service_account_file(
        path, scopes=GMAIL_SCOPES).with_subject(teacher_email)
    try:
        creds.refresh(Request())   # fails here, once, when delegation is missing
    except RefreshError as exc:
        raise EmailNotAvailable(
            'EMAIL_NOT_AUTHORIZED',
            "L'invio dalla tua casella non è autorizzato: l'amministratore di Google Workspace "
            "deve abilitare per l'account di servizio di QuizParty l'ambito "
            "https://www.googleapis.com/auth/gmail.send (delega a livello di dominio).",
        ) from exc
    return build('gmail', 'v1', credentials=creds, cache_discovery=False)


def send(service, msg: EmailMessage) -> None:
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    service.users().messages().send(userId='me', body={'raw': raw}).execute()
