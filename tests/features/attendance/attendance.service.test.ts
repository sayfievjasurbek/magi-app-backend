import { describe, it, expect, vi, beforeEach } from 'vitest';

// one chainable fake for the whole client: every awaited call takes the next queued { data, error }
const { from, builder, results } = vi.hoisted(() => {
  const results: { data: unknown; error: unknown }[] = [];
  const take = () => results.shift() ?? { data: null, error: null };
  const builder: Record<string, any> = {
    single: vi.fn(() => Promise.resolve(take())),
    maybeSingle: vi.fn(() => Promise.resolve(take())),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(take()).then(resolve),
  };
  for (const method of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'is', 'in', 'order', 'limit']) {
    builder[method] = vi.fn(() => builder);
  };
  const from = vi.fn(() => builder);
  return { from, builder, results };
});

vi.mock('../../../lib/db.js', () => ({ database: { from } }));

import { getAttendance, setAttendance } from '../../../features/attendance/attendance.service.js';
import { HttpError } from '../../../lib/errors.js';

const ok = (data: unknown) => ({ data, error: null });
const fail = (error: unknown) => ({ data: null, error });
const queue = (...items: { data: unknown; error: unknown }[]) => results.push(...items);

const MODULE = { id: 7, name: 'Writing Class' };

// the three calls requireManagedModule makes for a plain "professor" position managing a module
const managed = () => queue(ok({ position: 'professor' }), ok({ module_id: MODULE.id }), ok(MODULE));

const rejected = async (promise: Promise<unknown>): Promise<any> => promise.then(() => null, (error) => error);

beforeEach(() => {
  results.length = 0;
  from.mockClear();
});

describe('getAttendance', () => {
  it('returns the whole roster, null for a student nobody has marked', async () => {
    managed();
    queue(ok([{ student_id: 1 }, { student_id: 2 }, { student_id: 3 }]));
    queue(ok([{ student_id: 1, present: true }, { student_id: 3, present: false }]));

    const attendance = await getAttendance('7', 9, '2026-03-12');

    expect(attendance).toEqual([
      { student_id: 1, present: true },
      { student_id: 2, present: null },
      { student_id: 3, present: false },
    ]);
  });

  it('skips the attendance query entirely when the class has no students', async () => {
    managed();
    queue(ok([]));

    expect(await getAttendance('7', 9, '2026-03-12')).toEqual([]);
    expect(from).toHaveBeenCalledTimes(4); // the three for requireManagedModule, then module_student - never attendance
  });

  it('400s on a date that is not YYYY-MM-DD, without touching the database', async () => {
    for (const date of [undefined, '', 'tomorrow', '2026-3-12', '2026/03/12']) {
      const error = await rejected(getAttendance('7', 9, date));
      expect(error).toBeInstanceOf(HttpError);
      expect(error.status).toBe(400);
    }
    expect(from).not.toHaveBeenCalled();
  });

  it('404s when the professor does not manage the class', async () => {
    queue(ok({ position: 'professor' }), ok(null));

    const error = await rejected(getAttendance('7', 9, '2026-03-12'));

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(404);
  });
});

describe('setAttendance', () => {
  it('upserts and returns the saved entry', async () => {
    managed();
    queue(ok([{ student_id: 1 }, { student_id: 2 }]));
    queue(ok({ student_id: 1, present: true }));

    const entry = await setAttendance('7', '1', 9, { date: '2026-03-12', present: true });

    expect(entry).toEqual({ student_id: 1, present: true });
    const [upsertPayload, options] = builder.upsert.mock.calls[0];
    expect(upsertPayload).toMatchObject({ module_id: 7, student_id: 1, date: '2026-03-12', present: true, recorded_by: 9 });
    expect(options).toEqual({ onConflict: 'module_id,student_id,date' });
  });

  it('400s on a bad date or a non-boolean present', async () => {
    managed();
    expect((await rejected(setAttendance('7', '1', 9, { date: 'nope', present: true }))).status).toBe(400);

    managed();
    expect((await rejected(setAttendance('7', '1', 9, { date: '2026-03-12', present: 'yes' }))).status).toBe(400);
  });

  it("404s for a student id that does not parse, or one not enrolled in the class", async () => {
    managed();
    expect((await rejected(setAttendance('7', 'abc', 9, { date: '2026-03-12', present: true }))).status).toBe(404);

    managed();
    queue(ok([{ student_id: 2 }]));
    const error = await rejected(setAttendance('7', '1', 9, { date: '2026-03-12', present: true }));
    expect(error.status).toBe(404);
  });

  it('404s when the professor does not manage the class', async () => {
    queue(ok({ position: 'professor' }), ok(null));

    const error = await rejected(setAttendance('7', '1', 9, { date: '2026-03-12', present: true }));

    expect(error.status).toBe(404);
  });

  it('turns a storage failure into a plain error', async () => {
    managed();
    queue(ok([{ student_id: 1 }]));
    queue(fail({ message: 'constraint violation' }));

    const error = await rejected(setAttendance('7', '1', 9, { date: '2026-03-12', present: true }));

    expect(error).not.toBeInstanceOf(HttpError);
    expect(error.message).toContain('constraint violation');
  });
});
