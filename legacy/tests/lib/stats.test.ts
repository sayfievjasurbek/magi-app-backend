import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// stats.ts imports the Supabase client, which throws without DATABASE_URL/DATABASE_KEY
const { from, select, whereIn } = vi.hoisted(() => {
  const whereIn = vi.fn();
  const select = vi.fn(() => ({ in: whereIn }));
  const from = vi.fn(() => ({ select }));
  return { from, select, whereIn };
});

vi.mock('../../../lib/db.js', () => ({ database: { from } }));

import { average, fullName, countEnrollments, taskStatus, taskPriority } from '../../lib/stats.js';

describe('average', () => {
  it('returns null for no values', () => {
    expect(average([])).toBeNull();
  });

  it('averages the values', () => {
    expect(average([5])).toBe(5);
    expect(average([1, 2])).toBe(1.5);
    expect(average([10, 20, 30])).toBe(20);
    expect(average([-1, -2])).toBe(-1.5);
  });

  it('rounds to two decimals', () => {
    expect(average([1, 2, 2])).toBe(1.67);
    expect(average([1, 1, 2])).toBe(1.33);
    expect(average([0.1, 0.2])).toBe(0.15);
  });

  it('keeps a zero average', () => {
    expect(average([0, 0])).toBe(0);
    expect(average([-5, 5])).toBe(0);
  });
});

describe('fullName', () => {
  it('joins both names', () => {
    expect(fullName({ first_name: 'Ada', last_name: 'Lovelace' })).toBe('Ada Lovelace');
  });

  it('drops a missing last name without a trailing space', () => {
    expect(fullName({ first_name: 'Ada', last_name: null })).toBe('Ada');
    expect(fullName({ first_name: 'Ada', last_name: '' })).toBe('Ada');
  });
});

describe('countEnrollments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips the query for an empty list', async () => {
    await expect(countEnrollments([])).resolves.toEqual({});
    expect(from).not.toHaveBeenCalled();
  });

  it('counts the rows per class', async () => {
    whereIn.mockResolvedValue({
      data: [{ class_id: 'a' }, { class_id: 'b' }, { class_id: 'a' }],
      error: null,
    });

    await expect(countEnrollments(['a', 'b', 'c'])).resolves.toEqual({ a: 2, b: 1 });
    expect(from).toHaveBeenCalledWith('enrollments');
    expect(select).toHaveBeenCalledWith('class_id');
    expect(whereIn).toHaveBeenCalledWith('class_id', ['a', 'b', 'c']);
  });

  it('returns an empty map when nothing comes back', async () => {
    whereIn.mockResolvedValue({ data: null, error: null });
    await expect(countEnrollments(['a'])).resolves.toEqual({});
  });

  it('throws the database error message', async () => {
    whereIn.mockResolvedValue({ data: null, error: { message: 'connection refused' } });
    await expect(countEnrollments(['a'])).rejects.toThrow('connection refused');
  });
});

const NOW = Date.parse('2026-03-01T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const due = (offset: number) => new Date(NOW + offset).toISOString();

describe('taskStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the submission status when there is a submission', () => {
    expect(taskStatus({ status: 'pending_review' }, due(DAY))).toBe('pending_review');
    expect(taskStatus({ status: 'graded' }, due(-DAY))).toBe('graded');
  });

  it('is not_started before the deadline', () => {
    expect(taskStatus(undefined, due(DAY))).toBe('not_started');
  });

  it('is lapsed after the deadline', () => {
    expect(taskStatus(undefined, due(-1))).toBe('lapsed');
  });

  it('is still not_started exactly on the deadline', () => {
    expect(taskStatus(undefined, due(0))).toBe('not_started');
  });
});

describe('taskPriority', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('only escalates work that has not been started', () => {
    expect(taskPriority('pending_review', due(-DAY))).toBe('low');
    expect(taskPriority('graded', due(DAY))).toBe('low');
    expect(taskPriority('lapsed', due(-DAY))).toBe('low');
  });

  it('is high up to and including 3 days left', () => {
    expect(taskPriority('not_started', due(3 * DAY))).toBe('high');
    expect(taskPriority('not_started', due(DAY))).toBe('high');
    expect(taskPriority('not_started', due(0))).toBe('high');
    expect(taskPriority('not_started', due(-DAY))).toBe('high');
  });

  it('is medium just past 3 days and up to 7', () => {
    expect(taskPriority('not_started', due(3 * DAY + 1))).toBe('medium');
    expect(taskPriority('not_started', due(7 * DAY))).toBe('medium');
  });

  it('is low past 7 days', () => {
    expect(taskPriority('not_started', due(7 * DAY + 1))).toBe('low');
    expect(taskPriority('not_started', due(30 * DAY))).toBe('low');
  });
});
