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

### Cosa succedeva (risolto nella Fase 1)

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

Le domande aperte sono valutate esclusivamente dall'LLM oppure manualmente dal
docente. Il keyword scoring è troppo impreciso per assegnare punti e non deve
essere usato come fallback né come modalità alternativa.

Quando la valutazione LLM non è disponibile, la risposta aperta deve restare
**pending** con 0 punti fino a quando non viene valutata dall'LLM o dal docente:

- `grade_open_answer()` non ha alcun fallback: `score_open()` è stata eliminata.
- Un errore LLM produce uno stato `pending` con `points_awarded=0` e
  `llm_error` valorizzato. Non produce mai un voto definitivo.
- Il worker distingue errori temporanei, eventualmente ritentabili, da errori
  definitivi di configurazione. Entrambi lasciano la risposta `pending`; il
  dettaglio dell'errore resta visibile al docente.
- `score_entries.percent` continua a essere calcolato sul massimo totale,
  contando le risposte pending come 0. Finché esistono pending, il valore è
  esplicitamente un **punteggio provvisorio**, non il risultato definitivo.
- Le API espongono `grading_complete`, `pending_open_count` e
  `pending_open_weight`.
- Al momento della consegna, il frontend mostra un messaggio:
  «**Punteggio provvisorio: N risposte aperte non ancora valutate
  (X punti ancora da assegnare)**».
- Il banner appare ogni volta che lo studente consulta i punteggi e ci sono
  pending, finché tutte le aperte non sono state valutate.
- Lo stesso deve valere dopo la riapertura di una sessione: se arriva un nuovo
  submit e il LLM non è disponibile, le nuove aperte vanno in pending.
- Una sessione può essere chiusa con risposte ancora pending. Il punteggio
  rimane provvisorio e il banner rimane visibile allo studente finché il
  docente non completa la valutazione. Non viene impedita la chiusura: la
  responsabilità di completare il ciclo è del docente.
- Una valutazione manuale imposta `llm_status='graded'` e
  `manual_override=true`; non viene sovrascritta da rivalutazioni automatiche
  salvo richiesta esplicita del docente. Vedere la sezione
  **Invariante di sistema — Protezione valutazioni manuali**.

### Impatto

- `services/grading.py`: `grade_open_answer()` — fallback keyword rimosso.
  `score_open()` e `normalise()` sono state eliminate del tutto, non
  deprecate: nessun percorso, nemmeno di test, deve poter produrre un
  punteggio keyword.
- `services/llm_jobs.py`: preservare `pending` e `llm_error` quando il provider
  fallisce, senza convertire il risultato in `graded`.
- `services/quiz_session.py`: `submit_quiz()` — mostrare conteggio pending.
- `routes/quiz.py`: endpoint submit e punteggi — includere
  `grading_complete`, `pending_open_count` e `pending_open_weight`.
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

Ogni docente può configurare le proprie credenziali LLM. La prima
implementazione supporta soltanto meccanismi di autenticazione ufficialmente
documentati dal provider per applicazioni di terze parti.

**API key (OpenAI, Anthropic, DeepSeek, provider custom)**

Il docente incolla una chiave nel pannello impostazioni. Usata direttamente
nelle chiamate API secondo il protocollo del provider.

Le credenziali non vengono salvate in chiaro dentro `teachers.llm_config`.
Configurazione non sensibile e segreti hanno storage separato:

- `teachers.llm_config`: provider, modelli, endpoint e preferenze, senza segreti.
- `teacher_llm_credentials`: API key o token cifrati a livello applicativo.
- La chiave master di cifratura vive fuori dal database, in una variabile
  d'ambiente o secret Docker dedicato (`CREDENTIAL_ENCRYPTION_KEY`).
- Algoritmo: AES-256-GCM con IV/nonce casuale per ogni credenziale (o Fernet,
  che include HMAC per autenticità). L'algoritmo è fisso nel codice; nessuna
  auto-detection a runtime.
- Rotazione della chiave master: le credenziali già cifrate devono essere
  re-cifrate prima di sostituire `CREDENTIAL_ENCRYPTION_KEY`. Il modulo di
  cifratura espone `re_encrypt_all(old_key, new_key, conn)` — operazione
  offline, atomica per transazione, testabile in isolamento.
- Gli endpoint di lettura non restituiscono mai il segreto: mostrano soltanto
  stato configurato/non configurato e una fingerprint redatta.
- Log, eccezioni e audit non devono contenere credenziali.

**Struttura `teachers.llm_config` senza segreti**:

```json
{
  "providers": {
    "openai": {
      "type": "api_key",
      "models": ["gpt-4o-mini", "gpt-4o"]
    },
    "custom": {
      "type": "api_key",
      "base_url": "https://api.opencode.ai/v1",
      "models": ["opencode-gpt-4o"]
    }
  },
  "default_provider": "openai",
  "default_model": "gpt-4o-mini"
}
```

**UI**:
- Per provider API key: campo password «Incolla la tua chiave API».
- Dopo il salvataggio mostra soltanto «Chiave configurata» e la fingerprint
  redatta; la chiave non può essere riletta dal browser.

**OAuth/subscription**:

Il login di Codex CLI e le subscription ChatGPT/Codex non sono considerati
un'API OAuth pubblica riutilizzabile da QuizParty. Non si copiano token o
credenziali locali generati da client ufficiali e non si assume che una
subscription dia accesso alle normali API del provider.

Un provider OAuth potrà essere aggiunto in futuro solo se pubblica un flusso
ufficiale per applicazioni terze, con client registration, scope, callback,
refresh e condizioni d'uso documentate. Sarà una fase separata.

**Nessun fallback** a chiavi globali: se un docente non ha configurato
`llm_config`, semplicemente non può usare la valutazione LLM. Le risposte
aperte restano pending finché non configura le chiavi o valuta manualmente.

### Impatto

- Migrazione: `ALTER TABLE teachers ADD COLUMN llm_config JSONB` e nuova
  tabella `teacher_llm_credentials` per i segreti cifrati.
- Nuovo modulo: `services/llm_provider.py` — risolve provider/chiavi dal docente.
- Nuovo modulo o helper dedicato alla cifratura e rotazione delle credenziali.
- `services/grading.py`: `grade_open_answer()` riceve `teacher_id` e risolve le
  chiavi dal docente.
- `routes/teacher.py`: endpoint per salvare configurazione e credenziali; le
  risposte sono sempre redatte.
- `frontend`: nuova pagina o pannello «Configurazione LLM» nelle impostazioni
  docente.
- Rimozione dipendenza da variabili d'ambiente globali per le chiamate LLM.

---

## Problema 3 — Libreria `llm` di Datasette

### Cosa succede oggi

- Si usa la libreria Python `llm` (Datasette) con plugin per provider.
- I plugin hanno supporto parziale: es. il plugin DeepSeek non espone i modelli
  V4 Pro, V4 Flash.
- La lista dei modelli è cablata nei plugin e non c'è un modo pulito di
  configurare modelli arbitrari di un endpoint custom.
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

> Realizzata nella Fase 3 con una differenza: non esiste un provider
> `"custom"`. Il provider indica il **protocollo** (`openai`, `anthropic`,
> `deepseek`) e `base_url` sposta la destinazione, quindi un endpoint LAN è
> `provider="openai"` più `base_url`. La firma effettiva prende anche i prompt
> e i parametri di retry, perché il worker deve poter passare quelli fissati
> sul job invece di rileggerli. Vedere `services/llm_provider.py`.

```python
# services/llm_provider.py

def evaluate_open_question(
    *,
    question_text: str,
    student_answer: str,
    correct_answers: list[str],
    provider: str,        # "openai" | "anthropic" | "deepseek"
    model: str,           # "gpt-4o-mini" | "claude-sonnet-4-20250514" | ...
    api_key: str,
    base_url: str | None = None,
) -> dict:
    """Restituisce {'score': float 0-1, 'verdict': str, 'llm_feedback': str}"""
```

L'interfaccia restituisce un dizionario soltanto quando la risposta del
provider è valida e supera la validazione dello schema. In caso contrario
solleva eccezioni tipizzate:

```python
class LlmTemporaryError(Exception):
    """Timeout, rate limit o indisponibilità: il worker può ritentare."""

class LlmConfigurationError(Exception):
    """Credenziali, modello o endpoint non validi: richiede intervento docente."""

class LlmInvalidResponseError(Exception):
    """Risposta ricevuta ma non conforme allo schema atteso."""
```

`grade_open_answer()` propaga queste eccezioni. Non restituisce un punteggio
zero che potrebbe essere scambiato per una valutazione valida. Il worker è
l'unico responsabile di retry, stato `pending` e registrazione dell'errore.

Il contenuto del prompt resta invariato durante questo refactor; cambia solo il
trasporto. I file prompt vengono però spostati nella struttura versionata
descritta nella sezione sulla riproducibilità.

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

5. **Rivalutazione non distruttiva**:
   - Accodare un job non modifica punti, feedback, stato, provider o modello
     della valutazione corrente.
   - Per risposte mai valutate, lo stato corrente resta `pending`.
   - Per risposte già valutate, il voto corrente resta valido e visibile mentre
     la rivalutazione è in corso.
   - Il worker valida il nuovo risultato e sostituisce la risposta corrente
     nella stessa transazione che scrive lo storico.
   - Se il provider fallisce, la valutazione precedente resta invariata e il
     tentativo fallito viene registrato nel job. Una risposta senza valutazione
     precedente resta `pending`.
   - I `manual_override` sono esclusi per default e possono essere inclusi solo
     tramite un'opzione separata con conferma esplicita.

6. **Riproducibilità**: oltre a provider e modello, ogni valutazione registra
   `prompt_version` e i parametri effettivi rilevanti. I prompt vivono in file
   immutabili e versionati, per esempio:

   ```text
   prompts/open-question-system/
     v1-a3f8c2d1.md
     v2-79b14e62.md
   ```

   Lo slug contiene i primi 8 caratteri dell'hash SHA-256 del contenuto.
   Modificare il prompt significa aggiungere un nuovo file; un file già
   pubblicato non viene sovrascritto. Al momento dell'accodamento il backend
   legge il file selezionato e salva nel job sia `prompt_version` sia
   `prompt_snapshot`, cioè il testo esatto usato. Il worker usa esclusivamente
   lo snapshot del job, quindi una modifica o rimozione accidentale nel
   repository non cambia un job già in coda e lo storico rimane riproducibile.

### Impatto

- I campi `llm_provider`/`llm_model` restano nel JSONB `answers`, senza colonne
  dedicate.
- Una migrazione estende `llm_grading_jobs` con provider, modello,
  `prompt_version`, `prompt_snapshot`, parametri e scope della rivalutazione.
- `services/llm_provider.py`: popolare `llm_provider` e `llm_model` nel
  risultato.
- `services/llm_jobs.py`: `enqueue_regrade_session()` accetta `provider`
  e `model` opzionali; default dal `llm_config` del docente.
- `llm_grading_jobs`: memorizza provider, modello, prompt version e snapshot,
  scope della rivalutazione e parametri effettivi, così il worker non dipende
  da configurazione o file che potrebbero cambiare dopo l'accodamento.
- `routes/teacher.py`: endpoint regrade-open accetta `provider` e `model`
  nel body.
- `frontend/src/pages/SessionScoresPage.tsx`: pannello rivalutazione con
  dropdown modelli.
- `frontend/src/components/SubmissionDetailView.tsx`: mostrare provider/modello.

---

## Invariante di sistema — Protezione valutazioni manuali

Una risposta con `manual_override=true` è protetta per default da qualsiasi
rivalutazione automatica LLM. La protezione è applicata a tre livelli
complementari, in modo che nessun singolo punto di fallimento possa
sovrascrivere silenziosamente una valutazione manuale.

### 1. Il worker (enforcement primario)

Prima di scrivere ogni risposta, il worker controlla `manual_override` sulla
risposta corrente. Se `true` e il job ha `force_override_manual=false`, la
risposta viene saltata. Questo garantisce la protezione anche se il job è
stato accodato con parametri errati o se la UI non ha applicato il controllo.

### 2. Il job (scope persistente)

```sql
-- colonna da aggiungere a llm_grading_jobs
force_override_manual  BOOLEAN NOT NULL DEFAULT false
```

Il worker legge `force_override_manual` dal record del job, non da una
variabile runtime. Se un job è già in coda con `false`, un successivo cambio
di configurazione non altera il comportamento del job in corso.

La route `regrade-open` accetta `force_override_manual` nel body (default
`false`). Quando `true`, il frontend mostra una conferma esplicita con il
conteggio delle risposte manuali che verranno sovrascritte.

### 3. Il revert (ripristino del flag)

Quando un revert ripristina una risposta la cui `old_answer` aveva
`manual_override=true`, il revert deve ripristinare anche il flag, non solo
i punti. Altrimenti una rivalutazione successiva la tratterebbe come non
protetta.

### Gerarchia

```
manual_override=true  →  protetta da qualsiasi job LLM automatico (default)
                      →  sovrascrivibile solo con force_override_manual=true
                                          + conferma esplicita in UI
                      →  il revert ripristina il flag insieme ai punti
```

---

## Piano di implementazione

### Fase 1 — Semantica pending e punteggio provvisorio ✅ implementata

- `grade_open_answer()`: rimuove ogni fallback keyword.
- Il worker lascia `pending` con 0 punti quando una prima valutazione LLM
  fallisce e non converte l'errore in `graded`.
- `submit_quiz()` e le API punteggi includono `grading_complete`,
  `pending_open_count` e `pending_open_weight`.
- Frontend: banner di punteggio provvisorio dopo submit e nella pagina punteggi
  finché esistono risposte pending.
- Test verticali del contratto LLM riuscito, LLM fallito e review manuale.

La tassonomia di eccezioni tipizzate descritta sopra è entrata in questa fase
(non nella Fase 3): `services/llm_errors.py` è già usato da `llm_evaluator.py`,
`grade_open_answer()` e dal worker. `grade()` rinvia **sempre** le domande
aperte, quindi nessun percorso di richiesta può chiamare il provider.

### Fase 2 — Rivalutazione non distruttiva, storico e concorrenza ✅ implementata

- Accodare una rivalutazione non modifica la valutazione corrente.
- Migrazione `006` (non `005`, che è stata sostituita): tabelle
  `score_change_sets` e `score_history` + colonna
  `quiz_sessions.last_regrade_at`.
- La stessa migrazione aggiunge `answer_revision=0` alle risposte esistenti che
  non hanno ancora il campo; in lettura il campo assente viene comunque
  interpretato come `0` per compatibilità durante il rollout.
- Il worker LLM, `transform_scores()` e la route `review` scrivono in
  `score_history` a ogni modifica effettiva.
- Endpoint e UI per consultare lo storico e revertire atomicamente un intero
  change set.
- Un solo job `pending` o `running` per sessione, garantito dal database.
- Cooldown aggiornato atomicamente nella stessa transazione di accodamento.
- Test di job concorrenti, fallimento senza perdita del voto e conflitto sul
  revert.

### Fase 3 — Provider diretti e tracciamento ✅ implementata

Sostituisce la libreria `llm` con SDK diretti. Registra provider, modello,
prompt version e parametri effettivi, mantenendo invariata l'interfaccia
pubblica `grade_open_answer()`.

Come è stata realizzata:

- `services/llm_provider.py` chiama OpenAI e Anthropic tramite SDK ufficiale;
  DeepSeek usa il protocollo OpenAI con `base_url` diverso. I provider sono una
  allowlist fissa nel codice.
- `services/llm_config.py` risolve provider, modello e chiave. È il solo punto
  che legge l'ambiente: la Fase 4 ne sostituisce il corpo con le credenziali
  cifrate per docente, senza toccare i chiamanti. `resolve_llm_config()` accetta
  già un `teacher_id` che oggi ignora.
- I prompt vivono in `prompts/<nome>/v<N>-<sha8>.md` e sono immutabili:
  `services/prompts.py` rifiuta di caricare un prompt pubblicato il cui
  contenuto non corrisponde più all'hash nel nome.
- La migrazione `007` aggiunge a `llm_grading_jobs` le colonne `provider`,
  `model`, `prompt_version`, `prompt_snapshot` e `params`. Sono risolte
  all'accodamento; il worker legge solo dalla riga del job, quindi modificare un
  file di prompt o `LLM_MODEL` dopo l'accodamento non altera un job già in coda.
  Le credenziali non vengono mai scritte nel job: sono segreti e si rileggono
  sempre dalla configurazione viva.
- Ogni risposta valutata registra `llm_provider`, `llm_model` e
  `prompt_version` dentro il JSONB `answers`, e il dettaglio risposta li mostra
  al docente.
- `llm_evaluator.py` è stato eliminato insieme al suo timeout basato su
  subprocess; gli SDK hanno un timeout nativo. Il parsing delle risposte
  sopravvive in `services/llm_parsing.py`.

Gli endpoint LAN funzionano già: `LLM_BASE_URL` punta grading a qualsiasi
server che parli il protocollo scelto, con la chiave facoltativa perché quei
server spesso non autenticano. È configurazione amministrativa, quindi non
esiste superficie SSRF da difendere — vedere **Decisioni ulteriori 2**.

### Fase 4 — Credenziali cifrate per docente

Aggiunge `llm_config`, `teacher_llm_credentials`, endpoint redatti e gestione
della chiave master. In questa fase sono supportate le API key ufficiali; OAuth
resta escluso finché il provider non documenta un flusso per applicazioni terze.

Il docente configura **chiave e modello**, e sceglie l'endpoint solo tra le
voci della tabella `llm_endpoints` gestita dal super-admin, memorizzando
`endpoint_id` e mai la URL. Il vincolo da non violare: `base_url` non diventa
mai un campo di testo libero per il docente, altrimenti rientra dalla finestra
tutta la validazione SSRF che questo modello rende inutile. Schema e vincoli in
**Decisioni ulteriori 2**.

Ordine sensato di implementazione, dato che le due metà sono indipendenti:
prima `llm_endpoints` con il CRUD super-admin e la risoluzione per
`endpoint_id` — utile già da sola, perché sposta la configurazione degli
endpoint dal file `.env` a un'interfaccia amministrativa senza riavvio — poi
`teacher_llm_credentials` con cifratura, chiave master e rotazione, che è la
parte più delicata e non blocca la prima.

`services/llm_config.py::resolve_llm_config(teacher_id)` è il punto in cui
tutto questo entra: accetta già `teacher_id` e oggi lo ignora, quindi la fase
sostituisce il corpo di una funzione invece di propagarsi nel worker.

### Fase 5 — UI rivalutazione con scelta modello

Dipende dalle fasi precedenti. Aggiunge il pannello di rivalutazione avanzato,
la conferma per sovrascrivere valutazioni esistenti e la consultazione dello
storico con revert.

---

## Storico punteggi e revert (da implementare nella Fase 2)

Quando un punteggio viene modificato (rivalutazione LLM, recalculate,
review manuale), il vecchio valore viene perso. Serve una traccia completa
per audit e per ripristinare in modo affidabile una modifica.

Il solo delta dei punti non basta: una valutazione modifica anche stato,
feedback, verdetto, errore, provider, modello e timestamp. Lo storico salva
quindi l'intero oggetto `DetailedAnswer` prima e dopo la modifica, ma soltanto
per le risposte effettivamente cambiate.

Ogni `DetailedAnswer` contiene inoltre `answer_revision`, intero monotono che
parte da `0` e viene incrementato di `1` per qualsiasi modifica persistita
all'oggetto, inclusi feedback, modello e flag. Tutti i percorsi di scrittura
(`worker`, review manuale, recalculate e revert) aggiornano la revisione nella
stessa transazione della modifica, attraverso l'unico punto che decide che cosa
sia una modifica: `record_answer_changes()`.

Il confronto esclude `answer_revision` (è il valore che si sta calcolando) e
`llm_updated_at`: se il solo timestamp contasse come modifica, una
rivalutazione con esito identico incrementerebbe ogni revisione e renderebbe
permanentemente non annullabili tutti i change set precedenti.

### Tabelle `score_change_sets` e `score_history`

DDL come effettivamente rilasciato dalla migrazione `006`.

```sql
CREATE TABLE score_change_sets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          BIGINT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
    reason              TEXT NOT NULL CHECK (reason IN (
                            'submission',
                            'llm_grade',
                            'llm_regrade',
                            'manual_review',
                            'recalculate',
                            'revert'
                        )),
    actor_type          TEXT NOT NULL CHECK (actor_type IN ('teacher', 'system')),
    changed_by          BIGINT REFERENCES teachers(id) ON DELETE SET NULL,
    llm_job_id          BIGINT REFERENCES llm_grading_jobs(id) ON DELETE SET NULL,
    reverted_change_id  UUID REFERENCES score_change_sets(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (actor_type = 'teacher' AND changed_by IS NOT NULL)
        OR actor_type = 'system'
    )
);
CREATE INDEX idx_score_change_sets_session
    ON score_change_sets(session_id, created_at DESC);

CREATE TABLE score_history (
    id              BIGSERIAL PRIMARY KEY,
    change_set_id   UUID NOT NULL REFERENCES score_change_sets(id) ON DELETE CASCADE,
    score_entry_id  BIGINT NOT NULL REFERENCES score_entries(id) ON DELETE CASCADE,
    question_id     TEXT NOT NULL,
    answer_index    INT NOT NULL,
    old_revision    BIGINT NOT NULL,
    new_revision    BIGINT NOT NULL,
    old_answer      JSONB NOT NULL,
    new_answer      JSONB NOT NULL,
    old_raw_points  NUMERIC(10,2) NOT NULL,
    new_raw_points  NUMERIC(10,2) NOT NULL,
    old_percent     NUMERIC(6,2) NOT NULL,
    new_percent     NUMERIC(6,2) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((old_revision = 0 AND new_revision = 0) OR (new_revision = old_revision + 1)),
    UNIQUE (change_set_id, score_entry_id, question_id)
);
CREATE INDEX idx_score_history_entry
    ON score_history(score_entry_id, created_at DESC);
CREATE INDEX idx_score_history_change_set
    ON score_history(change_set_id);
```

`question_id` è l'identificatore stabile della risposta; `answer_index` viene
conservato per ripristinare efficientemente l'array JSONB e per compatibilità
con i dati storici. `old_answer.answer_revision` e
`new_answer.answer_revision` devono corrispondere alle colonne
`old_revision`/`new_revision`.

Il ramo `(0, 0)` del CHECK esiste per il change set `submission`: alla consegna
le risposte non hanno un valore precedente, quindi vengono registrate alla
revisione `0` senza incremento. Il change set di consegna è la base della
catena di audit e non è annullabile (`400`).

### Semantica del revert

Il revert non cancella né modifica lo storico originale:

1. Il docente seleziona un `score_change_set`.
2. Il backend blocca con `FOR UPDATE` tutti gli `score_entries` coinvolti.
3. Verifica che `current_answer.answer_revision == history.new_revision`.
   Qualsiasi modifica successiva, anche a feedback, modello o timestamp,
   incrementa la revisione e causa un conflitto `409`. Il revert non confronta
   selettivamente campi JSONB e non può quindi sovrascrivere silenziosamente
   metadati aggiornati dopo il change set.
4. Ripristina `old_answer` nella posizione individuata da `question_id`
   (usando `answer_index` solo come fallback), ma assegna una nuova revisione
   pari a `current_revision + 1`: la revisione non torna mai indietro.
5. Ricalcola `raw_points`, `max_points` e `percent` dall'array risultante.
6. Registra un nuovo `score_change_set` con `reason='revert'` e
   `reverted_change_id` riferito all'operazione originale.
7. Per ogni risposta ripristinata inserisce una nuova riga `score_history`.
   Il contenuto applicativo prima/dopo è invertito rispetto all'operazione
   originale, mentre le revisioni continuano a crescere. Se `old_answer` aveva
   `manual_override=true`, il revert ripristina anche il flag — non solo i
   punti.
8. Un change set già annullato non è annullabile una seconda volta (`409`):
   per ripristinarlo si annulla il change set di annullamento, così la catena
   di audit resta lineare.

Il revert è atomico per l'intero change set: o tutte le risposte vengono
ripristinate e registrate, oppure nessuna viene modificata.

Non si consente il revert diretto di un change set già revertito. Per annullare
un revert si esegue il revert dell'operazione di revert, mantenendo così una
catena audit completa.

### API proposta

```text
GET  /api/teacher/sessions/<session_id>/score-history
POST /api/teacher/sessions/<session_id>/score-history/<change_set_id>/revert
```

La lista restituisce operazione, autore, data, motivo, numero di risposte
modificate, modello LLM ed eventuale stato di revert. Il `POST` richiede una
conferma esplicita nel frontend.

### Integrazione

- `transform_scores()` crea un solo change set per ogni review o recalculate.
- Ogni job LLM crea un change set; tutte le risposte modificate dal job vi
  appartengono.
- Un job completamente fallito, che non modifica risposte, conserva errori e
  tentativi in `llm_grading_jobs` ma non crea righe `score_history`.
- Le righe di storico e l'aggiornamento di `score_entries` avvengono nella
  stessa transazione.
- Ogni modifica incrementa `answer_revision`; il valore nello storico è la
  condizione di concorrenza usata dal revert.
- Le risposte il cui contenuto non cambia non producono righe di storico.
- Provider e modello restano dentro `new_answer`/`old_answer`; i dati comuni
  del job restano in `llm_grading_jobs`.

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

- Granulare: registra solo le risposte cambiate, non l'intero array `answers`.
- Completo: conserva punti e tutti i metadati necessari per un vero revert.
- Query semplici e indicizzate.
- Abilita UI storico modifiche, revert atomico e audit log.
- Non confligge con `score_archives`, che resta per export e raw import.

## Rate limiting

Il solo controllo temporale non impedisce due richieste concorrenti. Servono
due protezioni complementari:

1. Un indice univoco parziale impedisce più job attivi per la stessa sessione:

```sql
CREATE UNIQUE INDEX uq_llm_active_regrade_per_session
ON llm_grading_jobs(session_id)
WHERE job_type = 'regrade_session'
  AND status IN ('pending', 'running');
```

2. `quiz_sessions.last_regrade_at` applica un cooldown contro doppi click e
abuso. La riga della sessione viene bloccata e aggiornata nella stessa
transazione che crea il job:

```python
MIN_REGRADE_INTERVAL = 60  # secondi

row = conn.execute(
    """SELECT EXTRACT(EPOCH FROM (now() - last_regrade_at))
       FROM quiz_sessions
       WHERE id = %s
       FOR UPDATE""",
    (session_id,)
).fetchone()
if row and row[0] is not None and row[0] < MIN_REGRADE_INTERVAL:
    raise TooManyRequests("Attendi N secondi prima di una nuova rivalutazione.")

conn.execute(
    "UPDATE quiz_sessions SET last_regrade_at = now() WHERE id = %s",
    (session_id,)
)
```

Una violazione dell'indice univoco restituisce `409 Conflict`: «Una
rivalutazione è già in corso». Il cooldown è configurabile via env
`LLM_REGRADE_COOLDOWN_SECONDS` con default 60 secondi.

## Decisioni ulteriori

1. **Costo**: la stima non è necessaria per la prima implementazione. Si
   registrano token di input/output e costo, quando il provider li restituisce;
   una stima preventiva può essere aggiunta in seguito.

2. **Endpoint LAN e modelli locali**: supportati fin dalla Fase 3, senza un
   provider `custom` e senza validazione SSRF. Un endpoint che parla il
   protocollo OpenAI o Anthropic (vLLM, llama.cpp, LiteLLM, l'API compatibile
   di Ollama) si configura scegliendo il protocollo in `LLM_PROVIDER` e
   l'indirizzo in `LLM_BASE_URL`:

   ```bash
   LLM_PROVIDER=openai
   LLM_BASE_URL=http://10.0.0.5:8000/v1
   LLM_MODEL=qwen2.5:14b
   ```

   `http://` è ammesso: su LAN è la norma. La chiave API diventa facoltativa
   quando `LLM_BASE_URL` è impostata, perché questi server spesso non
   autenticano; alle SDK viene passato un segnaposto. Se il gateway controlla
   un token, basta valorizzare la chiave del provider.

   **Perché non serve la protezione SSRF.** `LLM_BASE_URL` è una
   configurazione amministrativa: chi può scriverla controlla già il processo,
   quindi puntarla a un indirizzo interno non concede nulla di nuovo. La
   difesa SSRF descritta in precedenza serviva a validare una URL *arbitraria
   fornita da un utente*, ed è quel caso che non esiste.

   ### Endpoint selezionabili dal docente (Fase 4)

   Se in futuro il docente potrà scegliere l'endpoint, la scelta avviene
   **solo dentro una lista gestita dall'amministratore**. Il docente non
   fornisce mai una URL: fornisce un identificatore di una voce approvata.
   L'insieme degli indirizzi raggiungibili resta chiuso e definito da chi già
   controlla la configurazione, quindi non c'è nulla da validare — che è
   sostanzialmente più sicuro che tentare di validare una URL arbitraria.

   Vincoli implementativi, da rispettare perché la garanzia regga:

   - Nella configurazione del docente si memorizza **l'identificatore**, mai
     la URL. Salvare la URL renderebbe la lista non più autoritativa: un
     endpoint rimosso o ripuntato dall'amministratore continuerebbe a valere
     per chi l'aveva già scelto.
   - La URL si risolve **server-side al momento della chiamata**. Un
     identificatore che non esiste più solleva `LlmConfigurationError`, quindi
     le risposte restano `pending` — la direzione sicura.
   - Sul job, `base_url` segue la regola delle **credenziali**, non quella dei
     prompt: si registra per audit (endpoint e URL effettivamente usati
     finiscono nella provenienza della risposta) ma si ri-risolve dalla lista
     corrente prima di chiamare. Altrimenti un job in coda sopravvivrebbe alla
     revoca di un endpoint.
   - Ogni voce della lista dichiara se richiede una chiave. Un docente senza
     chiave propria può così valutare tramite il server della scuola, invece
     di non poter valutare affatto.

   **Decisione: la lista vive in una tabella `llm_endpoints`**, gestita dal
   super-admin, non in una variabile d'ambiente. Con ~150 docenti un cambio di
   endpoint non deve richiedere un'edit di `.env` e un riavvio, e
   `routes/super_admin.py` ha già il pattern CRUD di docenti e classi.

   ```sql
   CREATE TABLE llm_endpoints (
       id            BIGSERIAL PRIMARY KEY,
       slug          TEXT NOT NULL UNIQUE,   -- identificatore stabile, usato negli audit
       label         TEXT NOT NULL,          -- come appare al docente
       protocol      TEXT NOT NULL CHECK (protocol IN ('openai','anthropic','deepseek')),
       base_url      TEXT,                   -- NULL = endpoint ufficiale del provider
       requires_key  BOOLEAN NOT NULL DEFAULT true,
       models        JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [] = modello libero
       enabled       BOOLEAN NOT NULL DEFAULT true,
       created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
       updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   ```

   Note che discendono dai vincoli sopra:

   - `teachers.llm_config` memorizza `endpoint_id`, non la URL. La
     risoluzione è `SELECT ... WHERE id = %s AND enabled`, quindi disabilitare
     una voce revoca immediatamente anche i docenti che l'avevano già scelta.
   - Si revoca con `enabled = false`, non cancellando: la riga resta
     leggibile per spiegare valutazioni storiche.
   - `llm_grading_jobs` non ha una FK verso questa tabella. Registra
     `endpoint_id` e la `base_url` effettivamente usata come provenienza
     testuale, così un endpoint rimosso non rende illeggibile lo storico, ma
     il worker ri-risolve comunque dalla tabella prima di chiamare.
   - `requires_key = false` è ciò che permette a un docente senza chiave di
     valutare tramite il server della scuola.
   - `models` vuoto significa che il docente può indicare qualsiasi modello:
     utile per un server LAN che ne espone di arbitrari. Una lista non vuota
     lo vincola a quelli, utile per contenere i costi sui provider a pagamento.

   `LLM_BASE_URL` resta come configurazione di fallback a livello di
   installazione, per chi non popola la tabella.

3. **Temperature**: non viene esposta al docente. Il sistema usa il valore più
   deterministico supportato dal modello e registra i parametri effettivi.
   Questo riduce la variabilità ma non garantisce risultati identici; storico,
   conferma e revert restano necessari.
