import { beforeEach, describe, expect, it } from 'vitest';

import { clearLocal, purgeOldLocal, readLocal, restoreDraft, writeLocal } from '../lib/answerDraft';

beforeEach(() => localStorage.clear());

const server = (text: string) => ({ text, saved_at: '2026-10-25T10:00:00Z' });

describe('restoreDraft', () => {
  it('prefers work the server never received', () => {
    writeLocal('q1', 3, 'scritto offline', false);
    expect(restoreDraft('q1', 3, server('vecchia'))).toEqual({ text: 'scritto offline', unsent: true });
  });

  it('otherwise trusts the server, which may hold work from another computer', () => {
    writeLocal('q1', 3, 'già inviata', true);
    expect(restoreDraft('q1', 3, server('più recente'))).toEqual({ text: 'più recente', unsent: false });
  });

  it('falls back to the local copy, and to nothing', () => {
    writeLocal('q1', 3, 'solo qui', true);
    expect(restoreDraft('q1', 3, null).text).toBe('solo qui');
    expect(restoreDraft('q1', 4, null)).toEqual({ text: '', unsent: false });
  });

  it('keeps copies per quiz and question', () => {
    writeLocal('q1', 3, 'a', false);
    writeLocal('q2', 3, 'b', false);
    expect(restoreDraft('q2', 3, null).text).toBe('b');
  });
});

describe('local copies are cleaned up', () => {
  it('per question after saving, per quiz after handing in', () => {
    writeLocal('q1', 3, 'a', true);
    writeLocal('q1', 4, 'b', true);
    writeLocal('q2', 1, 'c', true);
    clearLocal('q1', 3);
    expect(readLocal('q1', 3)).toBeNull();
    expect(readLocal('q1', 4)).not.toBeNull();
    clearLocal('q1');
    expect(readLocal('q1', 4)).toBeNull();
    expect(readLocal('q2', 1)).not.toBeNull();
  });

  it('forgotten copies expire, other keys are left alone', () => {
    writeLocal('q1', 3, 'a', false);
    localStorage.setItem('qp_theme', 'dark');
    purgeOldLocal(Date.now() + 4 * 24 * 3600 * 1000);
    expect(readLocal('q1', 3)).toBeNull();
    expect(localStorage.getItem('qp_theme')).toBe('dark');
  });
});
