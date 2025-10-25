# QuizParty

## Overview

A self-contained quiz application designed for secure, offline classroom assessments. This system runs entirely on a
local area network (LAN) without requiring internet access, making it ideal for controlled testing environments in
schools and educational institutions.

**Key Features:**

- **Offline Operation**: Fully functional without internet connectivity - perfect for exam scenarios
- **No External Dependencies**: All data stored locally; no cloud services or external APIs required
- **Multiple Question Types**: Supports single choice, multiple choice, and open-ended questions with optional images
- **Automatic Grading**: Instant scoring for closed questions; keyword-based scoring for open responses
- **Admin Dashboard**: Real-time monitoring, score management, and result distribution via email
- **Fair Randomization**: Questions and answer options are shuffled once per student to prevent cheating while
  maintaining consistency
- **Data Integrity**: Automatic backups, file locking, and score recalculation capabilities

**Typical Use Case:** A teacher sets up the server on a local machine, students connect via LAN (e.g., classroom WiFi
or wired network), take their quizzes on their own devices, and results are instantly available to the instructor.
Optional email functionality can be configured if internet access is available after the exam.

## Directory layout

```sh
lan_quiz/     # project root directory
│
├─ frontend/  # React frontend
├─ server.py  # main server
├─ utils.py   # utils library
├─ routes/    # api routes
├─ questions.jsonc # master bank (with answers & weights)
├─ quizzes/   # auto‑generated one file per live quiz instance
│
├─ scores.jsonc  # submissions
│
├─ static/      # legacy frontend
├── index.html  # student UI
├── admin.html  # admin dashboard
├── main.js
└── style.css   # (optional) simple styling
```

quizzes/ is created automatically; each student that starts a quiz gets a file like student_id.json
describing only the randomized order of that quiz.

## Install instructions

install `node.js` following the official instructions for your operating system

clone the repository

```sh
git clone https://github.com/mlongano/intranet-quiz-manager.git
cd intranet-quiz-manager
```

### Windows

install uv

```powershell
powershell.exe -ExecutionPolicy Bypass -Command '
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy
Invoke-RestMethod "https://astral.sh/uv/install.ps1" | Invoke-Expression
'

$NewPath = "$($env:USERPROFILE)\.local\bin;$($env:Path)"
[Environment]::SetEnvironmentVariable("Path", $NewPath, [System.EnvironmentVariableTarget]::User)
```

optionally install pnpm

```powershell
powershell.exe -ExecutionPolicy Bypass -Command '
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy
Invoke-WebRequest https://get.pnpm.io/install.ps1 -UseBasicParsing | Invoke-Expression
'

$NewPath = "$($env:Path);$($env:LOCALAPPDATA)\pnpm"
[Environment]::SetEnvironmentVariable("Path", $NewPath, [System.EnvironmentVariableTarget]::User)
[Environment]::SetEnvironmentVariable("PNPM_HOME", "$($env:LOCALAPPDATA)\pnpm", [System.EnvironmentVariableTarget]::User)

```

### Linux and MacOs

install `uv` and `pnpm` using the official instructions

### setup the environment

create a `.env` file with the following content (you can copy from `.env.example`):

```sh
# Required: Admin password for accessing admin panel
ADMIN_PW=<your-super-secret-password>

# Optional: Email configuration for sending quiz results to students
# If not configured, email functionality will be disabled
EMAIL_SENDER=your.email@example.com
EMAIL_PASSWORD=your_app_password_here
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
```

#### Email Configuration (Optional)

To enable email functionality for sending quiz results to students:

1. **[For Gmail users:](./EMAIL_SETUP.md)**
   - Enable 2-factor authentication on your Google account
   - Generate an App Password at <https://myaccount.google.com/apppasswords>
   - Use the generated 16-character password as `EMAIL_PASSWORD`
   - Set `EMAIL_SENDER` to your Gmail address

2. **For other email providers:**
   - Set `SMTP_SERVER` to your provider's SMTP server
   - Set `SMTP_PORT` to the appropriate port (usually 587 for TLS)
   - Set `EMAIL_SENDER` to your email address
   - Set `EMAIL_PASSWORD` to your email password or app-specific password

**Note:** Email addresses in `students.jsonc` will be used as recipient addresses when sending quiz results.

create a `students.jsonc` file with the ids of the students who are taking the test

```jsonc
[
  "name@example.com",
  "name1@example.com",
  ...
]
```

create a `questions.jsonc` file to store the questions

```jsonc
[
  {
    "id": 1,
    "type": "single",
    "text": "Capital of France?",
    "options": ["Paris", "Rome", "Madrid", "Berlin"],
    "correct": 0,
    "weight": 1,
  },
  {
    "id": 2,
    "type": "multiple",
    "text": "Select the prime numbers:",
    "question_image": "test/question1.jpeg",
    "options": [
      {
        "text": "2",
        "image": "test/option1a.jpeg",
      },
      {
        "text": "4",
        "image": "test/option1b.jpeg",
      },
      {
        "text": "5",
        "image": "test/option1c.jpeg",
      },
      {
        "text": "9",
        "image": "test/option1d.jpeg",
      },
    ],

    "correct": [0, 2],
    "weight": 2,
  },
  {
    "id": "q7",
    "type": "open",
    "text": "Which gas do plants release during photosynthesis?",
    "question_image": "test/question2.jpeg",
    "options": [],
    "weight": 2,
    "acceptable": ["oxygen", "o2"],
  },
  {
    "id": "q8",
    "type": "open",
    "text": "Name three noble gases.",
    "options": [],
    "weight": 4,
    "keywords": ["helium", "neon", "argon", "krypton", "xenon", "radon"],
    "min_keywords": 3, // get full points when ≥ 3 found
  },
]
```

run the backend server

```sh
uv run server.py
```

run the frontend in developer mode

```sh
cd frontend
pnpm install
pnpm dev
```

deploy the frontend in production mode

```sh
cd frontend
pnpm install
pnpm build
```

now the frontend is served by the `server.py`

## Features

### Student Features

- **Quiz Taking**: Students log in with their email (must be in `students.jsonc`) and take randomized quizzes
- **Question Types**: Supports single choice, multiple choice, and open-ended questions
- **Images**: Questions and answer options can include images
- **Auto-save**: Quiz progress is automatically saved
- **Resume**: Students can resume incomplete quizzes from where they left off

### Admin Features

Access the admin panel at `/admin` with the password set in `.env`:

- **View Scores**: See all submitted quiz results with timestamps and percentages
- **Export CSV**: Export all scores to CSV format for external analysis
- **View Details**: Click any submission to see detailed question-by-question results
- **Recalculate Scores**: Re-grade all submissions against updated question bank (useful if answers change)
- **Send Emails**:
    - Send individual quiz results to specific students
    - Bulk send results to all students
    - Customize email subject
    - Choose to include or exclude detailed question-by-question breakdown
- **Question Management**: Edit questions, answers, and weights
- **Bank Management**: Save/load question banks and score archives

### Automatic Features

- **Shuffle Prevention**: Each student's answer options are shuffled once and saved to prevent re-randomization
- **Score Backup**: Automatic timestamped backups before recalculation
- **File Locking**: Thread-safe file operations prevent data corruption

## Admin Panel Usage

### Accessing Admin Panel

1. Navigate to `http://localhost:5000/admin` (or your server address)
2. Enter the admin password (set in `.env` as `ADMIN_PW`)
3. You'll be redirected to the admin dashboard

### Sending Quiz Results via Email

**Requirements**: Email must be configured in `.env` (see Email Configuration above)

**To send a single result:**

1. Go to the Scores page
2. Find the student's submission
3. Click the "📧 Email" button in that row
4. Enter the email subject (e.g., "Quiz Results - UF07-WEB")
5. Choose whether to include detailed question-by-question results
6. Click "Send Email"

**To send all results in bulk:**

1. Go to the Scores page
2. Click "📧 Email All Results" button at the top
3. Enter the email subject
4. Choose whether to include detailed results
5. Confirm to send to all students

**Email Content:**

- Summary with student name, quiz ID, score, percentage, and submission date
- Optional detailed breakdown showing each question, student's answer, correct answer, and points awarded
- Fully styled HTML email in Italian

### Recalculating Scores

If you need to update correct answers or question weights after students have submitted:

1. Edit the `questions.jsonc` file with updated answers/weights
2. Go to the Scores page in admin panel
3. Click "Recalculate All Scores" button
4. Confirm the action
5. All submissions will be re-graded automatically
6. A backup of old scores is saved to `scores_bank/` with timestamp

**Note**: The recalculation preserves each student's shuffled answer order, so scores are recalculated accurately.

## Troubleshooting

### Email Issues

- **"Email service not configured"**: Make sure `EMAIL_SENDER` and `EMAIL_PASSWORD` are set in `.env`
- **"Authentication failed"**:
    - For Gmail: Make sure 2FA is enabled and you're using an App Password (not your regular password)
    - For other providers: Check that your SMTP credentials are correct
- **"Invalid email address"**: Ensure student emails in `students.jsonc` are valid email format
- **No emails received**: Check spam/junk folders; verify SMTP settings are correct for your provider

### Student Login Issues

- **"Unknown student"**: The student email must be listed in `students.jsonc` exactly as typed
- **Server restart required**: After editing `students.jsonc`, restart the server for changes to take effect

### Score Issues

- **Scores show as 0 or incorrect**: Use "Recalculate All Scores" to re-grade against current question bank
- **Missing option_order**: Run the backfill script if you have old scores before option tracking was added

## TODO Section

- [ ] access the admin endpoint only from localhost
- [ ] check if the resume is from the same pc
- [x] handle the comments in the jsonc files
- [x] Markdown support (implemented with react-markdown)
- [ ] personalize the quiz for some student that has special needs
- [x] Email quiz results to students
- [x] Score recalculation against updated question bank
- [x] CSV export functionality
- [x] Question bank management and archiving
- [ ] Add a title to the quiz set in `questions.jsonc` and show it in the admin panel and ema
- [ ] Implement a timer for quizzes
- [ ] Improve UI/UX design of the frontend
- [ ] Improve error handling and user feedback throughout the app
- [ ] Internationalization (i18n) support
- [ ] Integration tests for backend and frontend components
- [ ] Dockerfile for easy deployment
- [ ] Documentation site with mkdocs
- [ ] Implement a feedback system for students
- [ ] Add support for more question types (e.g., matching, fill-in-the-blank)
- [ ] Use a database instead of JSONC files for better scalability
- [ ] Manage student list from the admin panel
- [ ]
