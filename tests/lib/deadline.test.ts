import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deadline, toSeconds } from '../../lib/deadline.js';

const NOW = new Date('2026-09-21T10:00:00.000Z');
const exam = { scheduled_start: '2026-09-21T09:00:00.000Z', scheduled_end: '2026-09-21T12:00:00.000Z' };
const attempt = { exam_id: 5, session_duration: 30, session_duration_unit: 'minutes' as const, started_at: '2026-09-21T09:30:00.000Z', unlimited_time: false };

beforeEach(() => {
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
