import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// lib/db.ts throws without env vars: one chainable fake answering from a queue
const { from, results } = vi.hoisted(() => {
  const results: any[] = [];
  const chain: any = { maybeSingle: () => Promise.resolve(results.length ? results.shift() : { data: null, error: null }) };
  for (const method of ['select', 'eq', 'is']) chain[method] = () => chain;
  return { from: vi.fn(() => chain), results };
});

vi.mock('../../lib/db.js', () => ({ database: { from } }));

import { attemptExpired, deadline, toSeconds } from '../../lib/deadline.js';

const NOW = new Date('2026-09-21T10:00:00.000Z');
const exam = { scheduled_start: '2026-09-21T09:00:00.000Z', scheduled_end: '2026-09-21T12:00:00.000Z' };
const attempt = { exam_id: 5, session_duration: 30, session_duration_unit: 'minutes' as const, started_at: '2026-09-21T09:30:00.000Z', unlimited_time: false };

beforeEach(() => {
  results.length = 0;
  from.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());

describe('deadline', () => {
  it('converts every time unit into seconds', () => {
    expect([toSeconds(2, 'seconds'), toSeconds(2, 'minutes'), toSeconds(2, 'hours'), toSeconds(2, 'days')]).toEqual([2, 120, 7200, 172800]);
  });

  it('ends the attempt at its own session limit', () => {
    expect(new Date(deadline(attempt, exam)).toISOString()).toBe('2026-09-21T10:00:00.000Z');
  });

  it('never runs past the end of the exam window', () => {
    expect(new Date(deadline({ ...attempt, session_duration: 10, session_duration_unit: 'hours' }, exam)).toISOString()).toBe(exam.scheduled_end);
  });

  it('counts from the start of the exam when the attempt never started', () => {
    expect(new Date(deadline({ ...attempt, started_at: null }, exam)).toISOString()).toBe('2026-09-21T09:30:00.000Z');
  });

  it('ignores both the session limit and the exam window once unlimited_time is set', () => {
    expect(deadline({ ...attempt, unlimited_time: true }, exam)).toBeGreaterThan(Date.parse(exam.scheduled_end));
  });
});

describe('attemptExpired', () => {
  it('reads the live exam of the attempt and compares it to the clock', async () => {
    results.push({ data: exam, error: null });

    expect(await attemptExpired({ ...attempt, session_duration: 45 })).toBe(false);
    expect(from).toHaveBeenCalledWith('exams');
  });

  it('is expired the moment the deadline is reached', async () => {
    results.push({ data: exam, error: null });

    expect(await attemptExpired(attempt)).toBe(true);
  });

  it('is expired when the exam behind the attempt is gone', async () => {
    results.push({ data: null, error: null });

    expect(await attemptExpired(attempt)).toBe(true);
  });

  it('turns a database error into a plain error', async () => {
    results.push({ data: null, error: { message: 'timeout' } });

    await expect(attemptExpired(attempt)).rejects.toThrow('timeout');
  });
});
