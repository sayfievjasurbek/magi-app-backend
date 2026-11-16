import { describe, it, expect, vi, beforeEach } from 'vitest';

// one chainable fake for the whole client: every awaited call takes the next queued { data, error }
const { from, builder, results } = vi.hoisted(() => {
  const results: { data: unknown; error: unknown }[] = [];
  const take = () => results.shift() ?? { data: null, error: null };
  const builder: Record<string, any> = {
    maybeSingle: vi.fn(() => Promise.resolve(take())),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(take()).then(resolve),
  };
  for (const method of ['select', 'eq', 'in', 'is']) builder[method] = vi.fn(() => builder);
  const from = vi.fn(() => builder);
  return { from, builder, results };
});

vi.mock('../../../lib/db.js', () => ({ database: { from } }));

import { listManagedProfessors } from '../../../features/auth/auth.controller.js';

const ok = (data: unknown) => ({ data, error: null });
const queue = (...items: { data: unknown; error: unknown }[]) => results.push(...items);

// query order for a plain professor
const plainProfessorQueue = () => queue(
  ok({ position: 'professor' }),
  ok([]),
  ok([{ user_id: 7 }]),
  ok([{ user_id: 7, professor_code: '33964', phone: null, position: 'professor' }]),
  ok([{ id: 7, first_name: 'Behruz', last_name: '123', email: 'behruz@magi.edu' }]),
);

beforeEach(() => {
  results.length = 0;
  from.mockClear();
});

describe('listManagedProfessors search', () => {
  it('matches a run-together query like "behruz123" against a name with a space ("Behruz" "123")', async () => {
    plainProfessorQueue();

    const found = await listManagedProfessors(1, 'behruz123');

    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(7);
  });

  it('still matches a plain name search the old way', async () => {
    plainProfessorQueue();
    expect(await listManagedProfessors(1, 'Behruz')).toHaveLength(1);
  });

  it('matches by email or professor_code too, run-together or not', async () => {
    plainProfessorQueue();
    expect(await listManagedProfessors(1, 'behruz@magi.edu')).toHaveLength(1);

    plainProfessorQueue();
    expect(await listManagedProfessors(1, '33964')).toHaveLength(1);
  });

  it('excludes a professor that genuinely does not match', async () => {
    plainProfessorQueue();
    expect(await listManagedProfessors(1, 'nodir')).toHaveLength(0);
  });
});
