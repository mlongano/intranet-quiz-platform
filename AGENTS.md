# AGENTS.md

Coding conventions for AI agents working on QuizParty.
For architecture, data models, quiz flow, and project context see **CLAUDE.md**.

## Development Commands

### Backend (Python)
```bash
uv run server.py              # Dev server (http://localhost:5001)
python3 -m py_compile <file>  # Syntax check
```

### Frontend (TypeScript + React)
```bash
cd frontend
pnpm install
pnpm dev          # Dev server (http://localhost:5173)
pnpm build        # Production build (includes type-check)
pnpm lint
```

### Testing
```bash
uv run pytest tests/          # pytest configured in pyproject.toml
```

---

## Python Style

### Import Order
```python
import os, re, unicodedata       # 1. stdlib
from pathlib import Path
import commentjson as json        # 2. third-party (NEVER plain `import json`)
from flask import Blueprint, request
from werkzeug.exceptions import NotFound, BadRequest
from utils import load_scores, ADMIN_PW  # 3. local
```

### Naming
- Constants: `UPPER_SNAKE_CASE` — `ADMIN_PW`, `SCORE_FILE`
- Functions/variables: `snake_case` — `load_scores`, `quiz_id`
- Blueprints: `<name>_bp` — `quiz_bp`, `admin_bp`
- Route handlers: `api_<action>` — `api_scores`, `api_submit`

### Error Handling
- Werkzeug exceptions: `abort(400)` bad request · `abort(403)` auth · `abort(404)` not found
- Catch specific exceptions: `FileNotFoundError`, `ValueError`

### Admin Authentication
```python
password = data.get('pw')
if not password or password != ADMIN_PW:
    abort(403)
```

### Logging
```python
print(f"[AUTH] Admin login attempt")  # print() only, no logging module
```

### File Writes — CRITICAL
Always use atomic helpers; never bare read-modify-write:
```python
# CORRECT
append_score_atomic(score_entry)              # quiz submissions
update_scores_atomic(lambda s: s + [item])    # admin bulk ops

# WRONG — race condition
scores = load_scores(); scores.append(x); save_scores(scores)
```

---

## TypeScript / React Style

### Import Order
```typescript
// 1. React & Router
import { useState } from "react";
import { useNavigate } from "react-router-dom";
// 2. TanStack Query
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
// 3. Third-party
import ReactMarkdown from "react-markdown";
// 4. Local
import { fetchScores, type Question } from "../api";
```

### Component Structure
```typescript
interface Props { data: Question; onSave: (val: string) => void; readOnly?: boolean }

function MyComponent({ data, onSave, readOnly = false }: Props) {
  const [value, setValue] = useState("");
  return <div>...</div>;
}

export default MyComponent;
```

### TypeScript Rules
- `no-explicit-any` is **disabled** in ESLint — `any` is allowed
- Strict mode enabled: `"strict": true`
- Define all types in `api.ts` first, import from there

### State & Data Fetching
- **Server state**: TanStack Query only — no bare `useEffect` + `fetch`
- **Client state**: `useState` only — no Redux/Zustand
- Query keys must include all dependencies: `["scores", password]`
- Invalidate after every mutation: `queryClient.invalidateQueries(...)`

### Error Handling
- No `alert()` or `confirm()` — inline UI only
```typescript
const [error, setError] = useState<string | null>(null);
try { await op(); } catch (err) { setError("Failed: " + String(err)); }
```

### Styling
- Tailwind v4 utility classes only
- Custom CSS only in `main.css`: `@theme` tokens and `.glass-panel`
- Design system: Neon Noir palette — tokens in `frontend/src/main.css`
- Responsive: `md:` / `lg:` prefixes

---

## Key Gotchas

1. **JSONC**: always `import commentjson as json` — never stdlib `json`
2. **Question IDs**: stringify always — `str(q_id)`
3. **Option indices**: extract with `re.search(r'\(Index:\s*(\d+)\)', formatted_answer)`
4. **Quiz progression**: question-by-question via `/api/save-answer`; answers are immutable once saved
5. **Admin password**: required in `.env` — app won't start without it
6. **Student identity**: email address (lowercased) used as login + filename key
7. **Frontend build**: run `pnpm build` before production; output goes to `frontend/dist/`
