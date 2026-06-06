# LLM Grading: valutazione aperte, chiavi, modelli e UI

Stato: draft — in discussione
Creato: 2026-06-06

## Contesto

Il 5 giugno uno studente ha sostenuto il quiz "Recupero Galli" (sessione 62).
Le 6 domande aperte sono state valutate dal LLM al submit (~37%). Il giorno
dopo l'insegnante ha cliccato "Rivaluta risposte aperte" e il punteggio è sceso
al ~30% perché lo stesso LLM ha dato punteggi diversi sullo stesso input.

L'analisi ha evidenziato quattro problemi strutturali da risolvere prima di
scrivere altro codice su valutazione/rivalutazione.

---

## Problema 1 — Fallback a parole chiave (keyword scoring)

### Cosa succede oggi

- L'env `USE_LLM_EVAL=1` abilita la valutazione LLM.
- Se la chiamata LLM fallisce (timeout, credenziali errate, quota esaurita),
  `grade_open_answer()` chiama `score_open()` come fallback.
- `score_open()` prova a matchare `acceptable` (itera la stringa come fosse
  array — non matcha mai) o `keywords` (match parziale).
- La risposta viene comunque marcata `llm_status = 'graded'` o `'fallback'`
  e il punteggio keyword viene salvato come definitivo.
- L'insegnante **non sa** se una risposta è stata valutata dall'LLM o dal
  fallback keyword.

### Cosa deve succedere

Quando la valutazione LLM non è disponibile, la risposta aperta deve restare
**pending** con 0 punti fino a quando non viene valutata esplicitamente:

- `grade_open_answer()` restituisce `points=0`, `llm_status='pending'`,
  `llm_error='LLM unavailable: <reason>'` invece di chiamare `score_open()`.
- La `points_awarded` nella `DetailedAnswer` resta 0; il `score_entries.percent`
  ignora le domande pending (o le conta come 0, ma con flag visibile).
- Al momento della consegna, il frontend mostra un messaggio:
  «**N risposte aperte non ancora valutate (X punti su Y)**»
- Il banner appare ogni volta che lo studente consulta i punteggi e ci sono
  pending, finché tutte le aperte non sono state valutate.
- Lo stesso deve valere dopo la riapertura di una sessione: se arriva un nuovo
  submit e il LLM non è disponibile, le nuove aperte vanno in pending.

### Impatto

- `services/grading.py`: `grade_open_answer()` — rimuovere fallback keyword.
- `services/quiz_session.py`: `submit_quiz()` — mostrare conteggio pending.
- `routes/quiz.py`: endpoint submit — includere `pending_open_count` nella
  response.
- `frontend`: `QuizPage.tsx` o componente punteggi — banner pending.
- `tests`: aggiornare test esistenti su `grade_open_answer`.

---

## Problema 2 — Chiavi API globali (`.env`)

### Cosa succede oggi

- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY` sono in `.env`.
- Tutti i docenti condividono le stesse chiavi e lo stesso modello.
- Se un docente esaurisce la sua quota OpenAI, **tutti** i docenti sono
  bloccati.
- Non c'è tracciabilità dei costi per docente.

### Cosa deve succedere

Ogni docente può configurare le proprie credenziali LLM. Ci sono **due tipi**
di autenticazione, non solo API key:

**1. API key (OpenAI, Anthropic, DeepSeek, provider custom)**

Il docente incolla una chiave nel pannello impostazioni. Usata direttamente
nelle chiamate API (header `Authorization: Bearer sk-...`).

**2. OAuth2 / subscription (Codex, OpenCode Go, …)**

Alcuni servizi non forniscono API key ma usano OAuth2 con login browser.
Esempio: Codex Pro si autentica con `codex login` che apre il browser,
l'utente autorizza, e il provider restituisce un JWT access token + refresh
token. Il token è legato all'account e determina quali modelli sono disponibili.

**Struttura `teachers.llm_config`**:

```json
{
  "providers": {
    "openai": {
      "type": "api_key",
      "api_key": "sk-...",
      "models": ["gpt-4o-mini", "gpt-4o"]
    },
    "openai-codex": {
      "type": "oauth",
      "access_token": "eyJ...",
      "refresh_token": "rt_...",
      "expires_at": "2026-06-07T12:00:00Z",
      "account_id": "9abf12f0-...",
      "models": ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "o4-mini"]
    },
    "custom": {
      "type": "api_key",
      "api_key": "...",
      "base_url": "https://api.opencode.ai/v1",
      "models": ["opencode-gpt-4o"]
    }
  },
  "default_provider": "openai-codex",
  "default_model": "gpt-4.1"
}
```

**Flusso OAuth per docente**:

1. Il docente clicca «Collega account Codex» nelle impostazioni.
2. Il backend genera un `state` token e reindirizza al provider OAuth.
3. Il docente autorizza nel browser.
4. Il provider reindirizza al callback del backend con il codice.
5. Il backend scambia il codice per access + refresh token e li salva in
   `teachers.llm_config`.
6. Prima di ogni chiamata LLM, se l'access token è scaduto, il backend
   usa il refresh token per ottenerne uno nuovo (trasparente al docente).

**UI**:
- Per provider API key: campo password «Incolla la tua chiave API».
- Per provider OAuth: pulsante «Collega account» che apre il flusso browser.
  Mostra stato: «Connesso come mauro@oruam.org» o «Non connesso».

**Nessun fallback** a chiavi globali: se un docente non ha configurato
`llm_config`, semplicemente non può usare la valutazione LLM. Le risposte
 aperte restano pending finché non configura le chiavi o valuta manualmente.

### Impatto

- Migrazione: `ALTER TABLE teachers ADD COLUMN llm_config JSONB`.
- Nuovo modulo: `services/llm_provider.py` — risolve provider/chiavi dal docente.
- `services/grading.py`: `grade_open_answer()` riceve `teacher_id` e risolve le
  chiavi dal docente.
- `routes/teacher.py`: endpoint per salvare/leggere `llm_config`.
- `frontend`: nuova pagina o pannello «Configurazione LLM» nelle impostazioni
  docente.
- Rimozione dipendenza da variabili d'ambiente globali per le chiamate LLM.

---

## Problema 3 — Libreria `llm` di Datasette

### Cosa succede oggi

- Si usa la libreria Python `llm` (Datasette) con plugin per provider.
- I plugin hanno supporto parziale: es. il plugin DeepSeek non espone i modelli
  V4 Pro, V4 Flash.
- Le subscription Codex Pro e OpenCode Go _possono_ funzionare puntando
  `OPENAI_API_BASE` al loro endpoint, ma la lista modelli è cablata nei plugin:
  non c'è modo pulito di esporre modelli arbitrari di un provider custom.
- Aggiunge un layer di astrazione non necessario per il nostro caso d'uso
  (una singola chiamata prompt/risposta).

### Cosa deve succedere

Sostituire `llm` con chiamate dirette via SDK nativi o HTTP:

- **OpenAI**: `openai` Python SDK (supporta anche endpoint custom).
- **Anthropic**: `anthropic` Python SDK.
- **DeepSeek**: OpenAI-compatibile → stesso `openai` SDK con `base_url`.
- **Provider custom**: qualsiasi endpoint OpenAI-compatibile.

Vantaggi:
- Accesso a **tutti** i modelli di ogni provider.
- Supporto per endpoint self-hosted (Ollama, vLLM, LiteLLM proxy).
- Controllo preciso su parametri (temperature, max_tokens, response_format).
- Meno dipendenze: si rimuove `llm` e i suoi plugin.

### Interfaccia proposta

```python
# services/llm_provider.py

def evaluate_open_question(
    *,
    question_text: str,
    student_answer: str,
    correct_answers: list[str],
    provider: str,        # "openai" | "anthropic" | "deepseek" | "custom"
    model: str,           # "gpt-4o-mini" | "claude-sonnet-4-20250514" | ...
    api_key: str,
    base_url: str | None = None,
) -> dict:
    """Restituisce {'score': float 0-1, 'verdict': str, 'llm_feedback': str}"""
```

Il sistema prompt (da `prompts/open-question-system.md`) resta invariato:
cambia solo il trasporto.

### Impatto

- Nuovo modulo `services/llm_provider.py`.
- Rimozione `llm` da `pyproject.toml` e `uv.lock`.
- `services/grading.py`: `grade_open_answer()` chiama `evaluate_open_question`
  del nuovo modulo.
- `services/llm_evaluator.py`: sostituito o rifattorizzato.
- Test: mockare le chiamate SDK invece della libreria `llm`.

---

## Problema 4 — Tracciamento modello e scelta in UI

### Cosa succede oggi

- Non viene registrato quale modello ha valutato una risposta.
- La rivalutazione usa sempre il modello configurato in `.env`.
- L'insegnante non può scegliere un modello diverso per la rivalutazione.
- Non c'è storia: se cambio modello, i punteggi cambiano senza spiegazione.

### Cosa deve succedere

1. **Registrazione**: ogni `DetailedAnswer` già ha i campi `llm_status`,
   `llm_verdict`, `llm_feedback`, `llm_error`, `llm_updated_at`. Aggiungere:
   - `llm_provider` (stringa: "openai", "anthropic", …)
   - `llm_model` (stringa: "gpt-4o-mini", …)

2. **UI punteggi**: nella vista dettaglio risposta, mostrare:
   «Valutata con **gpt-4o-mini** (OpenAI) il 05/06/2026 09:00»

3. **UI rivalutazione**: nella pagina `SessionScores`, il pulsante "Rivaluta
   risposte aperte" diventa un pannello con:
   - Dropdown dei modelli configurati dal docente
   - Preselezionato il modello già usato per le risposte esistenti
   - Checkbox: «Rivaluta solo risposte pending/error» (default on)
   - Checkbox: «Rivaluta anche risposte già valutate» (default off, con
     avvertimento che i punteggi possono cambiare)
   - Pulsante "Rivaluta"

4. **Protezione anti-regressione**: se l'insegnante sceglie di rivalutare
   risposte già valutate, mostrare un messaggio di conferma esplicito:
   «Attenzione: la rivalutazione può modificare i punteggi già assegnati,
   anche in diminuzione. Le risposte già valutate sono N.»

### Impatto

- Migrazione: nessuna (i campi `llm_provider`/`llm_model` sono JSONB
  dentro `answers`).
- `services/llm_provider.py`: popolare `llm_provider` e `llm_model` nel
  risultato.
- `services/llm_jobs.py`: `enqueue_regrade_session()` accetta `provider`
  e `model` opzionali; default dal `llm_config` del docente.
- `routes/teacher.py`: endpoint regrade-open accetta `provider` e `model`
  nel body.
- `frontend/src/pages/SessionScoresPage.tsx`: pannello rivalutazione con
  dropdown modelli.
- `frontend/src/components/SubmissionDetailView.tsx`: mostrare provider/modello.

---

## Piano di implementazione

### Fase 1 — Fallback → pending + storico + rate limit (priorità: immediata)

- `grade_open_answer()`: rimuove fallback keyword, restituisce `points=0`,
  `llm_status='pending'`, `llm_error='LLM unavailable: <reason>'`.
- `submit_quiz()`: la response include `pending_open_count` e `pending_open_weight`.
- Migrazione `005`: tabella `score_history` + colonna
  `quiz_sessions.last_regrade_at`.
- `enqueue_regrade_session()`, `grade()`, route `review`: scrivono in
  `score_history` a ogni cambio punteggio.
- `enqueue_regrade_session()`: controllo rate limit su `last_regrade_at`.
- Frontend: banner «N risposte non ancora valutate (X punti su Y)» dopo
  submit e nella pagina punteggi finché ci sono pending.

### Fase 2 — Chiavi per docente + tracciamento provider/modello

Dipende dalla Fase 1. Aggiunge `llm_config`, endpoint docente, colonne
`llm_provider`/`llm_model` negli answer.

### Fase 3 — Sostituzione libreria `llm` con SDK diretti

Dipende dalla Fase 2. Refactor interno: l'interfaccia pubblica
(`grade_open_answer`) non cambia.

### Fase 4 — UI rivalutazione con scelta modello

Dipende dalle Fasi 2 e 3. Aggiunge il pannello di rivalutazione avanzato
nel frontend.

---

## Storico punteggi (da implementare nella Fase 1)

Quando un punteggio viene modificato (rivalutazione LLM, recalculate,
review manuale), il vecchio valore viene perso. Serve traccia per audit
ed eventuale revert.

### Tabella `score_history`

```sql
CREATE TABLE score_history (
    id              BIGSERIAL PRIMARY KEY,
    score_entry_id  BIGINT NOT NULL REFERENCES score_entries(id) ON DELETE CASCADE,
    answer_index    INT NOT NULL,              -- posizione nell'array answers
    old_points      NUMERIC(10,2),             -- NULL se prima valutazione
    new_points      NUMERIC(10,2) NOT NULL,
    old_percent     NUMERIC(6,2),
    new_percent     NUMERIC(6,2) NOT NULL,
    reason          TEXT NOT NULL,             -- 'regrade_llm' | 'manual_review' | 'recalculate'
    llm_provider    TEXT,
    llm_model       TEXT,
    changed_by      BIGINT NOT NULL REFERENCES teachers(id),
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_score_history_entry ON score_history(score_entry_id, changed_at DESC);
```

### Perché NON `score_archives`

- `score_archives` è pensato per **esportazioni documentali** (copie integrali
  di una sessione in formato JSON): il suo scopo è preservare un documento,
  non tracciare modifiche incrementali.
- Ogni riga sarebbe una copia completa dell'array `answers` (46 domande × JSONB
  pesante) per un singolo cambio di punteggio.
- Query come «mostra lo storico della risposta 5» richiederebbero parsing
  dell'intero JSONB di ogni riga.
- Manca tracciamento granulare: quale campo è cambiato, chi, quando, perché.

### Vantaggi di `score_history`

- Leggero: registra solo il delta (old→new), non l'intero `answers`.
- Query semplici e indicizzate.
- Abilita future feature: UI storico modifiche, revert punteggio, audit log.
- Non confligge con `score_archives`, che resta per export e raw import.

## Rate limiting

Aggiunta colonna `quiz_sessions.last_regrade_at TIMESTAMPTZ`. In
`enqueue_regrade_session()`, controllo:

```python
MIN_REGRADE_INTERVAL = 60  # secondi

row = conn.execute(
    "SELECT EXTRACT(EPOCH FROM (now() - last_regrade_at)) FROM quiz_sessions WHERE id = %s",
    (session_id,)
).fetchone()
if row and row[0] is not None and row[0] < MIN_REGRADE_INTERVAL:
    raise TooManyRequests("Attendi N secondi prima di una nuova rivalutazione.")
```

Copre doppio click accidentale e abuso. Configurabile via env
`LLM_REGRADE_COOLDOWN_SECONDS` (default 60).

## Domande aperte

1. **Costo**: ogni docente paga il proprio provider. Serve un modo per
   mostrare il costo stimato di una rivalutazione prima di lanciarla?
   (Numero risposte × token stimati × prezzo modello)

2. **Modelli locali (Ollama)**: **Inclusi nella Fase 3**. Provider `custom`
   con `base_url: "http://host:11434/v1"`. Nessuna complessità aggiuntiva.

3. **Temperature**: vogliamo esporre la temperature nella configurazione
   docente? Temperature 0 darebbe risultati più deterministici ma meno
   "sfumati" nella valutazione.
