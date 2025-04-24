# Quizzes local lan web app

## Directory layout

```sh
lan_quiz/     # project root directory
│
├─ frontend/  # React frontend
├─ server.py  # main server
├─ utils.py   # utils library
├─ routes/    # api routes
├─ questions.json # master bank (with answers & weights)
├─ quizzes/   # auto‑generated one file per live quiz instance
│
├─ scores.json  # submissions
│
├─ static/      # legacy frontend
├── index.html  # student UI
├── admin.html  # admin dashboard
├── main.js
└── style.css   # (optional) simple styling
```

quizzes/ is created automatically; each student that starts a quiz gets a file like student_id.json describing only the randomized order of that quiz.

## Install instructions

### Windows

```sh
git clone https://github.com/mlongano/intranet-quiz-manager.git
cd intranet-quiz-manager
```

install uv

```powershell
powershell.exe -ExecutionPolicy Bypass -Command '
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy
Invoke-RestMethod "https://astral.sh/uv/install.ps1" | Invoke-Expression
'
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
