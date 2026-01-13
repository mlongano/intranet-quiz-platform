# AGENTS.md

This file provides coding guidelines for agents working on QuizParty.

## Development Commands

### Backend (Python)
```bash
uv run server.py              # Dev server (http://localhost:5001)
python3 -m py_compile <file>  # Syntax check
```

### Frontend (TypeScript + React)
```bash
cd frontend
pnpm install       # Install dependencies
pnpm dev          # Dev server (http://localhost:5173)
pnpm build         # Build for production (type-checks included)
pnpm lint          # Run ESLint
```

### Testing
**No test framework configured.** `tests/` directory exists but is empty.

---

## Code Style Guidelines

### Backend (Python)

#### Import Order
```python
import os, re, unicodedata  # Stdlib first
from pathlib import Path
import commentjson as json         # Third-party
from flask import Blueprint, request
from werkzeug.exceptions import NotFound, BadRequest
from utils import load_scores, ADMIN_PW  # Local imports
```

#### Error Handling
- Use Werkzeug exceptions: `abort(403)` (auth), `abort(404)` (not found), `abort(400)` (bad request)
- Always catch specific exceptions: `FileNotFoundError`, `ValueError`

#### File Operations - CRITICAL
- **Always use atomic operations** for concurrent writes to prevent race conditions:
  ```python
  # CORRECT
  from utils import append_score_atomic, update_scores_atomic

  append_score_atomic(score_entry)  # For quiz submissions
  update_scores_atomic(lambda scores: scores + [new_item])  # For admin ops
  ```
- **NEVER** do: `scores = load_scores(); scores.append(new); save_scores(scores)` ← race condition!

#### Naming
- Constants: `UPPER_SNAKE_CASE` (e.g., `ADMIN_PW`, `SCORE_FILE`)
- Functions: `snake_case` (e.g., `load_scores`)
- Variables: `snake_case` (e.g., `quiz_id`)
- Blueprints: `<name>_bp` pattern (e.g., `quiz_bp`, `admin_bp`)
- Route handlers: `api_<action>` (e.g., `api_scores`, `api_submit`)

#### JSONC Files
- **Always use `commentjson` library**, not standard `json`:
  ```python
  import commentjson as json  # NOT: import json
  ```

#### Admin Authentication
- Password from environment: `os.getenv('ADMIN_PW')`
- Check in every admin route: `if password != ADMIN_PW: abort(403)`

#### Logging
- Use `print()` for logging: `print(f"[AUTH] Admin login attempt")`

---

### Frontend (TypeScript + React)

#### Import Organization
```typescript
// 1. React & Router
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

// 2. TanStack Query
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// 3. Third-party
import ReactMarkdown from "react-markdown";

// 4. Local imports
import { fetchScores, type Question } from "../api";
```

#### Component Structure
```typescript
interface Props { data: Question; onSave: (val: string) => void; readOnly?: boolean }

function MyComponent({ data, onSave, readOnly = false }: Props) {
  const [value, setValue] = useState("");
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value);
  return <div>...</div>;
}

export default MyComponent;
```

#### State Management
- **Server state**: Always use TanStack Query:
  ```typescript
  const { data, isLoading } = useQuery({
    queryKey: ["scores", adminPassword],
    queryFn: () => fetchScores(adminPassword),
  });

  // Invalidate after mutations
  queryClient.invalidateQueries({ queryKey: ["scores", adminPassword] });
  ```
- **Client state**: `useState` only (no Redux/Zustand)

#### TypeScript Rules
- **`no-explicit-any` is DISABLED** in ESLint: `"off"`
- **Strict mode enabled**: `"strict": true`
- **Define types in `api.ts` first**, then import

#### Error Handling
- **No browser alerts**: Use inline UI for all confirmations/errors
- **Display errors inline** with state:
  ```typescript
  const [error, setError] = useState<string | null>(null);
  try { await operation(); }
  catch (err) { setError("Failed: " + err.message); }
  ```

#### TanStack Query Patterns
- **Query keys**: Arrays with dependency values: `queryKey: ["scores", password]`
- **Auto-refresh**: Use `refetchInterval: 30000` for live data (30s)
- **No localStorage for quiz state**: Always fetch from server

#### Styling
- **Tailwind CSS v4 utility classes only** (no custom CSS)
- **Responsive**: Use `md:`, `lg:` prefixes
- **Dark mode**: Not implemented

---

## Critical Patterns

### Server-Authoritative Quiz State
- Quiz progression stored server-side in `quizzes/{student_id}.json`
- Client NEVER stores quiz state in localStorage
- Students resume using `quiz_id` from server

### File Format: JSONC
- Use `commentjson` library for Python (supports comments in data files)
- Files: `questions.jsonc`, `scores.jsonc`, `students.jsonc`

### Bank System
- **All banks in `banks/`** directory: `question_bank/`, `scores_bank/`, `students_bank/`
- **Git sync**: Optional cloud backup to GitHub/GitLab

### Students Format Support
Three accepted formats (can be mixed):
```jsonc
["email@example.com"]                           // Simple strings
[{"email": "name@example.com", "group": "5CI"}]  // Individual
[{"group": "5CI", "emails": ["a@ex.com", "b@ex.com"]}]  // Group
```

---

## Common Gotchas

1. **Race Conditions**: Always use `append_score_atomic()` or `update_scores_atomic()` in utils.py
2. **Question IDs**: Can be strings or integers → always stringify: `str(q_id)`
3. **Option Order Preservation**: Extract indices with regex: `r'\(Index:\s*(\d+)\)'`
4. **Admin Password**: Required in `.env` → app fails to start without it
5. **Frontend Build**: Must run `pnpm build` before production deployment
6. **Email Format**: Student identifier is email address (lowercased)
7. **No Tests**: No test framework configured → manual testing only

---

## Environment Variables

Required in `.env`:
```bash
ADMIN_PW=your_password  # REQUIRED
```

Optional:
```bash
EMAIL_SENDER=...           # Email configuration
EMAIL_PASSWORD=...
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587

BANKS_GIT_REMOTE=...      # Git sync (cloud backup)
BANKS_GIT_TOKEN=...
```
