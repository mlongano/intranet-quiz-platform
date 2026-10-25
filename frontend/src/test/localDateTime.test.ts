import { describe, expect, it } from 'vitest';

import { fromLocalInput, toLocalInput } from '../lib/localDateTime';

describe('datetime-local conversion', () => {
  it('round-trips an instant through the local input value', () => {
    const iso = '2026-11-03T08:15:00.000Z';
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
  });

  it('empty means no schedule', () => {
    expect(toLocalInput(null)).toBe('');
    expect(fromLocalInput('')).toBeNull();
  });

  it('the input value is local wall-clock time', () => {
    const local = new Date(2026, 10, 3, 9, 30);       // 3 Nov 2026 09:30 local
    expect(toLocalInput(local.toISOString())).toBe('2026-11-03T09:30');
  });
});
