# Quizzes local lan web app

## Directory layout

```sh
lan_quiz/ # project root directory
│
├─ app.py
├─ questions.json # master bank (with answers & weights)
├─ quizzes/ # auto‑generated one file per live quiz instance
│
├─ scores.json # submissions
│
└─ static/
├─ index.html # student UI
├─ admin.html # admin dashboard
├─ main.js
└─ style.css # (optional) simple styling
```

quizzes/ is created automatically; each student that starts a quiz gets a file like student_id.json describing only the randomized order of that quiz.
