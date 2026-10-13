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
  for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'is', 'in', 'ilike', 'order', 'limit']) {
    builder[method] = vi.fn(() => builder);
  };
  const from = vi.fn(() => builder);
  return { from, builder, results };
});

vi.mock('../../../lib/db.js', () => ({ database: { from } }));

import * as moduleService from '../../../features/modules/module.service.js';

const ok = (data: unknown) => ({ data, error: null });
const okCount = (count: number) => ({ data: null, error: null, count });
const fail = (error: unknown) => ({ data: null, error });
const queue = (...items: { data: unknown; error: unknown }[]) => results.push(...items);

const MODULE = { id: 7, name: 'Algorithms' };
const SUE = { id: 5, first_name: 'Sue', last_name: 'Kim', email: 'sue@magi.edu' };

// the three calls findManagedModule makes for a plain "professor" position managing a module:
// the position lookup (not an admin), then the module_professor link, then the module itself
const managed = () => queue(ok({ position: 'professor' }), ok({ module_id: MODULE.id }), ok(MODULE));

beforeEach(() => {
  results.length = 0;
  vi.clearAllMocks();
});

describe('createModule', () => {
  it('rejects a missing or empty name', async () => {
    await expect(moduleService.createModule(3, {})).rejects.toMatchObject({ status: 400 });
    await expect(moduleService.createModule(3, { name: '   ' })).rejects.toMatchObject({ status: 400 });
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects a name longer than the column', async () => {
    await expect(moduleService.createModule(3, { name: 'a'.repeat(101) })).rejects.toMatchObject({ status: 400 });
  });

  it('inserts the module and makes the creator its professor', async () => {
    queue(ok([]), ok(MODULE), ok(null));

    expect(await moduleService.createModule(3, { name: '  Algorithms  ' })).toEqual(MODULE);
    expect(from).toHaveBeenNthCalledWith(1, 'modules');
    expect(from).toHaveBeenNthCalledWith(2, 'modules');
    expect(builder.insert).toHaveBeenNthCalledWith(1, { name: 'Algorithms' });
    expect(from).toHaveBeenNthCalledWith(3, 'module_professor');
    expect(builder.insert).toHaveBeenNthCalledWith(2, { module_id: 7, professor_id: 3 });
  });

  it('rejects a name that already belongs to another active class', async () => {
    queue(ok([{ id: 11 }]));

    await expect(moduleService.createModule(3, { name: 'Algorithms' })).rejects.toMatchObject({ status: 409 });
    expect(builder.insert).not.toHaveBeenCalled();
  });

  it('removes the module again when the professor link fails', async () => {
    queue(ok([]), ok(MODULE), fail({ message: 'link failed' }), ok(null));

    await expect(moduleService.createModule(3, { name: 'Algorithms' })).rejects.toThrow('link failed');
    expect(from).toHaveBeenNthCalledWith(4, 'modules');
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith('id', 7);
  });
});

describe('listModules', () => {
  it('gives a professor the managed modules with their student count and professors', async () => {
    queue(
      ok({ position: 'professor' }),
      ok([{ module_id: 1 }, { module_id: 2 }]),
      ok([{ id: 1, name: 'A' }, { id: 2, name: 'B' }]),
      ok([{ module_id: 1, student_id: 10 }, { module_id: 1, student_id: 11 }]),
      ok([{ id: 10 }, { id: 11 }]),
      ok([{ module_id: 1, professor_id: SUE.id }]),
      ok([SUE])
    );

    expect(await moduleService.listModules(9, 'professor')).toEqual([
      { id: 1, name: 'A', student_count: 2, professors: [SUE] },
      { id: 2, name: 'B', student_count: 0, professors: [] },
    ]);
    expect(from).toHaveBeenNthCalledWith(1, 'professors');
    expect(from).toHaveBeenNthCalledWith(2, 'module_professor');
    expect(builder.eq).toHaveBeenCalledWith('professor_id', 9);
    expect(builder.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('asks for no modules when the professor manages none', async () => {
    queue(ok({ position: 'professor' }), ok([]));

    expect(await moduleService.listModules(9, 'professor')).toEqual([]);
    expect(from).toHaveBeenCalledTimes(2);
  });

  it('gives an administrator every active module, not just the ones they manage', async () => {
    queue(
      ok({ position: 'Administrator' }),
      ok([{ id: 1 }, { id: 7 }]),
      ok([{ id: 1, name: 'A' }, { id: 7, name: 'G' }]),
      ok([{ module_id: 7, student_id: 10 }]),
      ok([{ id: 10 }]),
      ok([])
    );

    expect(await moduleService.listModules(9, 'professor')).toEqual([
      { id: 1, name: 'A', student_count: 0, professors: [] },
      { id: 7, name: 'G', student_count: 1, professors: [] },
    ]);
    expect(from).toHaveBeenNthCalledWith(1, 'professors');
    expect(from).toHaveBeenNthCalledWith(2, 'modules');
  });

  it('gives a student the modules they are enrolled in', async () => {
    queue(ok([{ module_id: 5 }]), ok([{ id: 5, name: 'A' }]));

    expect(await moduleService.listModules(4, 'student')).toEqual([{ id: 5, name: 'A' }]);
    expect(from).toHaveBeenNthCalledWith(1, 'module_student');
    expect(builder.eq).toHaveBeenCalledWith('student_id', 4);
  });
});

describe('getProfessorModules', () => {
  it('gives the groups a professor is attached to', async () => {
    queue(ok([{ module_id: 1 }, { module_id: 2 }]), ok([{ id: 1, name: 'A' }, { id: 2, name: 'B' }]));

    expect(await moduleService.getProfessorModules('9')).toEqual([{ id: 1, name: 'A' }, { id: 2, name: 'B' }]);
    expect(from).toHaveBeenNthCalledWith(1, 'module_professor');
    expect(builder.eq).toHaveBeenCalledWith('professor_id', 9);
  });

  it('skips the lookup for an unparseable id', async () => {
    expect(await moduleService.getProfessorModules('nope')).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it('answers empty when the professor manages no groups', async () => {
    queue(ok([]));

    expect(await moduleService.getProfessorModules('9')).toEqual([]);
    expect(from).toHaveBeenCalledTimes(1);
  });
});

describe('getModule', () => {
  it('answers 404 for an id that is not an id', async () => {
    await expect(moduleService.getModule(3, 'professor', 'abc')).rejects.toMatchObject({ status: 404 });
    expect(from).not.toHaveBeenCalled();
  });

  it('answers 404 for a module the professor does not manage', async () => {
    queue(ok({ position: 'professor' }), ok(null));

    await expect(moduleService.getModule(3, 'professor', '7')).rejects.toMatchObject({ status: 404 });
  });

  it('answers 404 for a soft deleted module', async () => {
    queue(ok({ position: 'professor' }), ok({ module_id: 7 }), ok(null));

    await expect(moduleService.getModule(3, 'professor', '7')).rejects.toMatchObject({ status: 404 });
  });

  it("gives an administrator any active module, not just ones they're linked to", async () => {
    queue(ok({ position: 'Administrator' }), ok(MODULE), ok([]), ok([]));

    expect(await moduleService.getModule(3, 'professor', '7')).toEqual({ ...MODULE, student_count: 0, professors: [] });
  });

  it('adds the student count and mentors for a professor', async () => {
    managed();
    queue(
      ok([{ module_id: 7, student_id: 1 }, { module_id: 7, student_id: 2 }, { module_id: 7, student_id: 3 }]),
      ok([{ id: 1 }, { id: 2 }, { id: 3 }]),
      ok([{ module_id: 7, professor_id: 3 }]),
      ok([{ id: 3, first_name: 'Ada', last_name: null, email: 'ada@magi.edu' }])
    );

    expect(await moduleService.getModule(3, 'professor', '7')).toEqual({
      ...MODULE,
      student_count: 3,
      professors: [{ id: 3, first_name: 'Ada', last_name: null, email: 'ada@magi.edu' }],
    });
  });

  it('answers 404 for a student who is not enrolled', async () => {
    queue(ok(null));

    await expect(moduleService.getModule(5, 'student', '7')).rejects.toMatchObject({ status: 404 });
    expect(from).toHaveBeenCalledWith('module_student');
  });

  it('gives an enrolled student the module with its mentors', async () => {
    queue(ok({ module_id: 7 }), ok(MODULE), ok([]), ok([{ module_id: 7, professor_id: SUE.id }]), ok([SUE]));

    expect(await moduleService.getModule(5, 'student', '7')).toEqual({ ...MODULE, student_count: 0, professors: [SUE] });
  });
});

describe('getRoster', () => {
  it('lists the professors and the students of the module for a professor', async () => {
    managed();
    queue(
      ok([{ professor_id: 3 }]),
      ok([{ student_id: 5 }]),
      ok([{ id: 3, first_name: 'Ada', last_name: null, email: 'ada@magi.edu' }]),
      ok([SUE])
    );

    expect(await moduleService.getRoster(3, 'professor', '7')).toEqual({
      professors: [{ id: 3, first_name: 'Ada', last_name: null, email: 'ada@magi.edu' }],
      students: [SUE],
    });
  });

  it('answers 404 for a module the professor does not manage', async () => {
    queue(ok(null));

    await expect(moduleService.getRoster(3, 'professor', '7')).rejects.toMatchObject({ status: 404 });
  });

  it('asks for no users when the module is empty', async () => {
    managed();
    queue(ok([]), ok([]));

    expect(await moduleService.getRoster(3, 'professor', '7')).toEqual({ professors: [], students: [] });
    expect(from).not.toHaveBeenCalledWith('users');
  });

  it('gives an enrolled student the roster of their own class', async () => {
    queue(
      ok({ module_id: 7 }),
      ok(MODULE),
      ok([{ professor_id: 3 }]),
      ok([{ student_id: 5 }]),
      ok([{ id: 3, first_name: 'Ada', last_name: null, email: 'ada@magi.edu' }]),
      ok([SUE])
    );

    expect(await moduleService.getRoster(5, 'student', '7')).toEqual({
      professors: [{ id: 3, first_name: 'Ada', last_name: null, email: 'ada@magi.edu' }],
      students: [SUE],
    });
  });

  it('answers 404 for a student who is not enrolled', async () => {
    queue(ok(null));

    await expect(moduleService.getRoster(5, 'student', '7')).rejects.toMatchObject({ status: 404 });
  });
});

describe('updateModule', () => {
  it('answers 404 for a module the professor does not manage', async () => {
    queue(ok(null));

    await expect(moduleService.updateModule(3, '7', { name: 'New' })).rejects.toMatchObject({ status: 404 });
  });

  it('rejects an empty name', async () => {
    managed();

    await expect(moduleService.updateModule(3, '7', { name: '' })).rejects.toMatchObject({ status: 400 });
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('renames the module', async () => {
    managed();
    queue(ok([]), ok({ ...MODULE, name: 'Data Structures' }));

    expect(await moduleService.updateModule(3, '7', { name: 'Data Structures' })).toEqual({ ...MODULE, name: 'Data Structures' });
    expect(builder.update).toHaveBeenCalledWith({ name: 'Data Structures' });
  });

  it('rejects a new name that already belongs to another active class', async () => {
    managed();
    queue(ok([{ id: 11 }]));

    await expect(moduleService.updateModule(3, '7', { name: 'Taken' })).rejects.toMatchObject({ status: 409 });
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('excludes its own row, so keeping the same name (or just changing its case) is fine', async () => {
    managed();
    queue(ok([]), ok({ ...MODULE, name: 'algorithms' }));

    await moduleService.updateModule(3, '7', { name: 'algorithms' });
    expect(builder.neq).toHaveBeenCalledWith('id', 7);
  });
});

describe('deleteModule', () => {
  it('stamps deleted_at and keeps the reason', async () => {
    managed();
    queue(ok(null));

    await moduleService.deleteModule(3, '7', { reason: 'merged into Algorithms II' });

    const patch = builder.update.mock.calls[0][0];
    expect(patch.reason).toBe('merged into Algorithms II');
    expect(Number.isNaN(Date.parse(patch.deleted_at))).toBe(false);
  });

  it('defaults the reason to null', async () => {
    managed();
    queue(ok(null));

    await moduleService.deleteModule(3, '7', {});
    expect(builder.update.mock.calls[0][0].reason).toBeNull();
  });

  it('rejects a reason that is not a string', async () => {
    managed();

    await expect(moduleService.deleteModule(3, '7', { reason: 42 })).rejects.toMatchObject({ status: 400 });
  });
});

describe('addStudent', () => {
  it('needs an email or a studentId', async () => {
    managed();

    await expect(moduleService.addStudent(3, '7', {})).rejects.toMatchObject({ status: 400 });

    managed();
    await expect(moduleService.addStudent(3, '7', { studentId: 0 })).rejects.toMatchObject({ status: 400 });
  });

  it('answers 404 when no user has that email', async () => {
    managed();
    queue(ok(null));

    await expect(moduleService.addStudent(3, '7', { email: 'nobody@magi.edu' })).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a user who is not a student', async () => {
    managed();
    queue(ok(SUE), ok(null));

    await expect(moduleService.addStudent(3, '7', { email: 'sue@magi.edu' })).rejects.toMatchObject({
      status: 400,
      message: 'This user is not a student',
    });
    expect(from).toHaveBeenCalledWith('students');
  });

  it('enrolls the student found by a trimmed, lowercased email', async () => {
    managed();
    queue(ok(SUE), ok({ user_id: 5 }), ok(null));

    expect(await moduleService.addStudent(3, '7', { email: '  Sue@Magi.edu ' })).toEqual(SUE);
    expect(builder.eq).toHaveBeenCalledWith('email', 'sue@magi.edu');
    expect(builder.insert).toHaveBeenCalledWith({ module_id: 7, student_id: 5 });
  });

  it('enrolls the student found by id', async () => {
    managed();
    queue(ok(SUE), ok({ user_id: 5 }), ok(null));

    expect(await moduleService.addStudent(3, '7', { studentId: 5 })).toEqual(SUE);
    expect(builder.eq).toHaveBeenCalledWith('id', 5);
  });

  it('turns a duplicate enrollment into 409', async () => {
    managed();
    queue(ok(SUE), ok({ user_id: 5 }), fail({ code: '23505', message: 'duplicate key' }));

    await expect(moduleService.addStudent(3, '7', { studentId: 5 })).rejects.toMatchObject({ status: 409 });
  });
});

describe('addProfessor', () => {
  it('refuses a user who is not a professor', async () => {
    managed();
    queue(ok(SUE), ok(null));

    await expect(moduleService.addProfessor(3, '7', { professorId: 5 })).rejects.toMatchObject({
      status: 400,
      message: 'This user is not a professor',
    });
    expect(from).toHaveBeenCalledWith('professors');
  });

  it('adds the co-professor', async () => {
    managed();
    queue(ok(SUE), ok({ user_id: 5 }), ok(null));

    expect(await moduleService.addProfessor(3, '7', { professorId: 5 })).toEqual(SUE);
    expect(builder.insert).toHaveBeenCalledWith({ module_id: 7, professor_id: 5 });
  });

  it('turns a duplicate professor into 409', async () => {
    managed();
    queue(ok(SUE), ok({ user_id: 5 }), fail({ code: '23505', message: 'duplicate key' }));

    await expect(moduleService.addProfessor(3, '7', { professorId: 5 })).rejects.toMatchObject({ status: 409 });
  });
});

describe('removeStudent', () => {
  it('answers 404 when the student is not enrolled', async () => {
    managed();
    queue(ok([]));

    await expect(moduleService.removeStudent(3, '7', '5')).rejects.toMatchObject({ status: 404 });
  });

  it('answers 404 for an id that is not an id', async () => {
    managed();

    await expect(moduleService.removeStudent(3, '7', 'abc')).rejects.toMatchObject({ status: 404 });
    expect(builder.delete).not.toHaveBeenCalled();
  });

  it('removes the enrollment of the module only', async () => {
    managed();
    queue(ok([{ student_id: 5 }]));

    await moduleService.removeStudent(3, '7', '5');
    expect(from).toHaveBeenLastCalledWith('module_student');
    expect(builder.eq).toHaveBeenCalledWith('module_id', 7);
    expect(builder.eq).toHaveBeenCalledWith('student_id', 5);
  });
});

describe('removeProfessor', () => {
  it('answers 404 when the professor does not manage the module', async () => {
    managed();
    queue(okCount(2), ok([]));

    await expect(moduleService.removeProfessor(3, '7', '4')).rejects.toMatchObject({ status: 404 });
  });

  it('removes the co-professor', async () => {
    managed();
    queue(okCount(2), ok([{ professor_id: 4 }]));

    await moduleService.removeProfessor(3, '7', '4');
    expect(builder.eq).toHaveBeenCalledWith('professor_id', 4);
  });

  it('refuses to remove the last professor managing the module', async () => {
    managed();
    queue(okCount(1));

    await expect(moduleService.removeProfessor(3, '7', '4')).rejects.toMatchObject({ status: 409 });
    expect(builder.delete).not.toHaveBeenCalled();
  });
});

describe('getModuleRating', () => {
  it('answers 404 for an id that is not an id', async () => {
    await expect(moduleService.getModuleRating(4, 'student', 'abc')).rejects.toMatchObject({ status: 404 });
    expect(from).not.toHaveBeenCalled();
  });

  it('answers 404 for a module the student is not enrolled in', async () => {
    queue(ok(null));
    await expect(moduleService.getModuleRating(4, 'student', '7')).rejects.toMatchObject({ status: 404 });
  });

  it('answers 404 for a soft deleted module even though the enrollment row is still there', async () => {
    queue(ok({ module_id: 7 }), ok(null));
    await expect(moduleService.getModuleRating(4, 'student', '7')).rejects.toMatchObject({ status: 404 });
  });

  it('answers 404 for a module the professor does not manage', async () => {
    queue(ok(null));
    await expect(moduleService.getModuleRating(3, 'professor', '7')).rejects.toMatchObject({ status: 404 });
  });

  it('returns an empty leaderboard for a module with no members', async () => {
    managed();
    queue(ok([]));

    expect(await moduleService.getModuleRating(3, 'professor', '7')).toEqual([]);
  });

  it("sums each member's graded score across the module's own exams, highest first", async () => {
    managed();
    queue(
      ok([{ student_id: 10 }, { student_id: 11 }]),
      ok([{ exam_id: 1 }]),
      ok([{ student_id: 10, assignment_id: 100 }, { student_id: 11, assignment_id: 101 }]),
      ok([{ id: 100, score: 60 }, { id: 101, score: 85 }]),
      ok([
        { id: 10, first_name: 'A', last_name: null, email: 'a@magi.edu' },
        { id: 11, first_name: 'B', last_name: null, email: 'b@magi.edu' },
      ])
    );

    expect(await moduleService.getModuleRating(3, 'professor', '7')).toEqual([
      { student: { id: 11, first_name: 'B', last_name: null, email: 'b@magi.edu' }, total_score: 85 },
      { student: { id: 10, first_name: 'A', last_name: null, email: 'a@magi.edu' }, total_score: 60 },
    ]);
  });

  it('excludes a member whose own account was soft-deleted', async () => {
    managed();
    queue(
      ok([{ student_id: 10 }, { student_id: 11 }]),
      ok([]),
      ok([{ id: 10, first_name: 'A', last_name: null, email: 'a@magi.edu' }])
    );

    expect(await moduleService.getModuleRating(3, 'professor', '7')).toEqual([
      { student: { id: 10, first_name: 'A', last_name: null, email: 'a@magi.edu' }, total_score: 0 },
    ]);
  });
});
