# Quizzes local lan web app

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

quizzes/ is created automatically; each student that starts a quiz gets a file like student_id.json describing only the randomized order of that quiz.

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

create a `.env` file with the following content:

```sh
ADMIN_PW=<your-super-secret-password>
```

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

## TODO Section

- [ ] access the admin endpoint only from localhost
- [ ] check if the resume is from the same pc
- [ ] handle the comments in the jsoncfiles
- [ ] Markdown support
- [ ] personalize the quiz for some student that has special needs
