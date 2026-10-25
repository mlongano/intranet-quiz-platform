/**
 * Keeping a student's open answer safe while it is being written.
 *
 * Two copies, for two kinds of failure:
 * - the server draft (POST /quiz/save-draft), autosaved a moment after the
 *   student stops typing and when the page is hidden or closed: it survives a
 *   crashed or replaced computer;
 * - a local copy in this browser, written on every change: it survives a lost
 *   connection, and is sent as soon as the server answers again.
 *
 * The local copy remembers whether the server has it. Restoring prefers an
 * unsent local copy (it holds work the server never saw), otherwise the
 * server's draft. Comparing timestamps instead would trust two different
 * clocks. This is a safety copy, not quiz state: the server stays the only
 * authority on answers and progression.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, saveDraft, type AnswerDraft } from '../api';

const PREFIX = 'qp_draft:';
const MAX_AGE_MS = 3 * 24 * 3600 * 1000;   // a forgotten copy does not linger on a shared PC
const IDLE_MS = 2000;                      // save this long after the last keystroke
const MAX_WAIT_MS = 10000;                 // and at least this often while typing
const RETRY_MS = 10000;

interface LocalCopy {
  text: string;
  synced: boolean;   // the server has this exact text
  at: number;        // for expiry only, never for ordering
}

const key = (quizId: string, index: number) => `${PREFIX}${quizId}:${index}`;

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export function readLocal(quizId: string, index: number): LocalCopy | null {
  try {
    const raw = storage()?.getItem(key(quizId, index));
    if (!raw) return null;
    const copy = JSON.parse(raw) as LocalCopy;
    return typeof copy.text === 'string' ? copy : null;
  } catch { return null; }
}

export function writeLocal(quizId: string, index: number, text: string, synced: boolean) {
  try {
    storage()?.setItem(key(quizId, index), JSON.stringify({ text, synced, at: Date.now() }));
  } catch { /* full or blocked: the server copy still protects the work */ }
}

export function clearLocal(quizId: string, index?: number) {
  const s = storage();
  if (!s) return;
  try {
    const prefix = index === undefined ? `${PREFIX}${quizId}:` : key(quizId, index);
    for (const k of Object.keys(s)) {
      if (index === undefined ? k.startsWith(prefix) : k === prefix) s.removeItem(k);
    }
  } catch { /* nothing to clean */ }
}

export function purgeOldLocal(now = Date.now()) {
  const s = storage();
  if (!s) return;
  try {
    for (const k of Object.keys(s)) {
      if (!k.startsWith(PREFIX)) continue;
      try {
        const copy = JSON.parse(s.getItem(k) ?? '') as LocalCopy;
        if (!(now - copy.at < MAX_AGE_MS)) s.removeItem(k);
      } catch { s.removeItem(k); }
    }
  } catch { /* nothing to clean */ }
}

/** Which text to show when the question opens: unsent local work first. */
export function restoreDraft(quizId: string, index: number, server: AnswerDraft | null | undefined) {
  const local = readLocal(quizId, index);
  if (local && !local.synced && local.text.trim()) return { text: local.text, unsent: true };
  if (server?.text) return { text: server.text, unsent: false };
  if (local?.text) return { text: local.text, unsent: !local.synced };
  return { text: '', unsent: false };
}

export type DraftStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: Date }
  | { kind: 'offline' }                     // kept in this browser, will retry
  | { kind: 'expired' }                     // token expired: the student must re-enter the code
  | { kind: 'stopped'; message: string };   // the server refuses: keep the local copy only

/**
 * Autosave the open answer of the current question: call `reset()` with the
 * restored text when a question opens and `edited()` on every change.
 */
export function useAnswerDraft(quizId: string | undefined, index: number, enabled: boolean) {
  const [status, setStatus] = useState<DraftStatus>({ kind: 'idle' });
  const latest = useRef('');
  const sent = useRef<string | null>(null);      // last text the server confirmed
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const idleTimer = useRef<number | undefined>(undefined);
  const maxTimer = useRef<number | undefined>(undefined);
  const retryTimer = useRef<number | undefined>(undefined);
  const stopped = useRef(false);
  // Bumped on every reset: a save still in flight for the previous question
  // must not touch the state of the next one.
  const generation = useRef(0);


  const clearTimers = () => {
    window.clearTimeout(idleTimer.current);
    window.clearTimeout(maxTimer.current);
    window.clearTimeout(retryTimer.current);
    idleTimer.current = maxTimer.current = retryTimer.current = undefined;
  };

  const flush = useCallback(async (keepalive = false) => {
    if (!quizId || !enabled || stopped.current || !dirty.current) return;
    if (inFlight.current && !keepalive) return;
    clearTimers();
    const body = latest.current;
    const gen = generation.current;
    inFlight.current = true;
    if (!keepalive) setStatus({ kind: 'saving' });
    try {
      const res = await saveDraft(quizId, index, body, keepalive);
      if (gen !== generation.current) return;
      sent.current = body;
      if (latest.current === body) {
        dirty.current = false;
        writeLocal(quizId, index, body, true);
      }
      setStatus({ kind: 'saved', at: new Date(res.saved_at) });
    } catch (err) {
      if (gen !== generation.current) return;
      if (err instanceof ApiError && err.code === 'TOKEN_EXPIRED') {
        // Kept locally; retried with the new token once the code is re-entered.
        setStatus({ kind: 'expired' });
        retryTimer.current = window.setTimeout(() => { void flush(); }, RETRY_MS);
      } else if (err instanceof ApiError && err.status !== 401 && err.status < 500) {
        // Closed session, question already answered elsewhere, too long:
        // retrying cannot help. The local copy stays.
        stopped.current = true;
        setStatus({ kind: 'stopped', message: err.message });
      } else {
        // No connection, server down or token expired: keep trying.
        setStatus({ kind: 'offline' });
        retryTimer.current = window.setTimeout(() => { void flush(); }, RETRY_MS);
      }
    } finally {
      inFlight.current = false;
      if (gen === generation.current && dirty.current && !stopped.current && retryTimer.current === undefined) {
        idleTimer.current = window.setTimeout(() => { void flush(); }, IDLE_MS);
      }
    }
  }, [quizId, index, enabled]);

  /** Restored text that the server never received counts as unsaved. */
  const reset = useCallback((restored: string, unsent: boolean) => {
    generation.current += 1;
    inFlight.current = false;
    clearTimers();
    stopped.current = false;
    latest.current = restored;
    dirty.current = unsent;
    sent.current = unsent ? null : restored;
    setStatus({ kind: 'idle' });
    if (unsent) idleTimer.current = window.setTimeout(() => { void flush(); }, IDLE_MS);
  }, [flush]);

  const edited = useCallback((value: string) => {
    if (!quizId || !enabled) return;
    latest.current = value;
    dirty.current = value !== sent.current;
    writeLocal(quizId, index, value, !dirty.current);
    if (stopped.current) return;
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => { void flush(); }, IDLE_MS);
    if (maxTimer.current === undefined) {
      maxTimer.current = window.setTimeout(() => { maxTimer.current = undefined; void flush(); }, MAX_WAIT_MS);
    }
  }, [quizId, index, enabled, flush]);

  // Leaving or hiding the page: send now, with keepalive so the request
  // survives the tab closing. Unsent work also asks before leaving.
  useEffect(() => {
    if (!enabled) return;
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(true); };
    const onPageHide = () => { void flush(true); };
    const onOnline = () => { void flush(); };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current) { void flush(true); e.preventDefault(); }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('online', onOnline);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [enabled, flush]);

  useEffect(() => () => clearTimers(), []);

  return { status, edited, reset, flush };
}
