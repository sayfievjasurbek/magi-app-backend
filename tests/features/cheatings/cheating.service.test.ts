import { describe, it, expect, vi, beforeEach } from 'vitest';

// chainable fake db, each awaited query takes the next queued result
const { from, calls, results } = vi.hoisted(() => {
  const calls: any[][] = [];
  const results: any[] = [];
  const take = () => (results.length ? results.shift() : { data: null, error: null });
  const chain: any = {
    single: () => Promise.resolve(take()),
    maybeSingle: () => Promise.resolve(take()),
    then: (resolve: any, reject: any) => Promise.resolve(take()).then(resolve, reject),
  };
  for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'order', 'limit']) {
    chain[method] = (...args: any[]) => {
      calls.push([method, ...args]);
      return chain;
    };
  }
  const from = vi.fn((table: string) => {
    calls.push(['from', table]);
    return chain;
  });
  return { from, calls, results };
});

vi.mock('../../../lib/db.js', () => ({ database: { from } }));

import { createIncident, listIncidents, getIncident, dismissIncident, examSummary } from '../../../features/cheatings/cheating.service.js';
import { HttpError } from '../../../lib/errors.js';

const queue = (...rows: any[]) => results.push(...rows);
const row = (data: any) => ({ data, error: null });
const none = { data: null, error: null };
const fails = (message: string) => ({ data: null, error: { message } });

const tables = () => calls.filter(([method]) => method === 'from').map(([, table]) => table);
const callsOf = (method: string) => calls.filter(([name]) => name === method);

const rejected = async (promise: Promise<unknown>): Promise<any> => promise.then(() => null, (error) => error);

const running = row({ id: 7, exam_id: 3, status: 'in_progress', submitted_at: null });
const owner = row({ assignment_id: 7 });
// the live exam behind the attempt, then the module join: what lib/exam-access.ts reads for a professor
const someoneElsesExam = row({ id: 3, created_by: 4 });
const teaches = [someoneElsesExam, row([{ module_id: 2 }]), row([{ module_id: 2 }])];
const incident = row({ id: 31, name: 'copy_paste', explanation: 'pasted 400 characters', created_at: 'now' });

const student = { id: 5, role: 'student' } as const;
const professor = { id: 9, role: 'professor' } as const;
const examiner = { id: 9, role: 'examiner' } as const;

beforeEach(() => {
  calls.length = 0;
  results.length = 0;
  from.mockClear();
});

describe('createIncident', () => {
  it('writes the incident, its link and flags the attempt for the student who owns it', async () => {
    queue(running, owner, incident, none, none);

    const cheating = await createIncident('7', student, 'copy_paste', 'pasted 400 characters');

    expect(cheating.id).toBe(31);
    expect(tables()).toEqual(['assignments', 'student_assignment', 'cheatings', 'cheating_reason', 'assignments']);
    expect(callsOf('insert')).toEqual([
      ['insert', { name: 'copy_paste', explanation: 'pasted 400 characters' }],
      ['insert', { assignment_id: 7, cheating_id: 31 }],
    ]);
    expect(callsOf('update')).toEqual([['update', { status: 'flagged' }]]);
    expect(calls.at(-1)).toEqual(['in', 'status', ['in_progress', 'submitted', 'auto_submitted']]);
  });

  it('never flags a graded attempt: the update filters on the status itself', async () => {
    queue(running, owner, incident, none, none);

    await createIncident('7', student, 'copy_paste', 'pasted');

    const statuses = callsOf('in').at(-1)?.[2];
    expect(statuses).not.toContain('graded');
    expect(statuses).not.toContain('pending');
  });

  it('lets a professor of the exam record a manual review on a submitted attempt', async () => {
    queue(row({ id: 7, exam_id: 3, status: 'submitted', submitted_at: 'yesterday' }), ...teaches, incident, none, none);

    const cheating = await createIncident('7', professor, 'manual_review', 'reviewed the recording');

    expect(cheating.id).toBe(31);
    expect(tables()).toEqual(['assignments', 'exams', 'exam_module', 'module_professor', 'cheatings', 'cheating_reason', 'assignments']);
    expect(callsOf('insert')[0]).toEqual(['insert', { name: 'manual_review', explanation: 'reviewed the recording' }]);
  });

  it('lets an examiner assigned to the exam record an incident', async () => {
    queue(running, someoneElsesExam, row({ exam_id: 3 }), incident, none, none);

    await createIncident('7', examiner, 'face_mismatch', 'another face');

    expect(tables()).toEqual(['assignments', 'exams', 'exam_examiner', 'cheatings', 'cheating_reason', 'assignments']);
  });

  it('lets the professor who created an exam that is linked to no module record an incident', async () => {
    queue(running, row({ id: 3, created_by: professor.id }), incident, none, none);

    const cheating = await createIncident('7', professor, 'manual_review', 'reviewed the recording');

    expect(cheating.id).toBe(31);
    expect(tables()).toEqual(['assignments', 'exams', 'cheatings', 'cheating_reason', 'assignments']);
  });

  it('403s when a student reports a manual review', async () => {
    const error = await rejected(createIncident('7', student, 'manual_review', 'because'));

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  it('400s on a type outside type_cheating_types', async () => {
    for (const name of [undefined, '', 'looked_away', 'MANUAL_REVIEW', 7]) {
      const error = await rejected(createIncident('7', professor, name, 'because'));
      expect(error.status).toBe(400);
    }
    expect(from).not.toHaveBeenCalled();
  });

  it('400s without an explanation', async () => {
    for (const explanation of [undefined, '', '   ', 'x'.repeat(1001)]) {
      const error = await rejected(createIncident('7', student, 'copy_paste', explanation));
      expect(error.status).toBe(400);
    }
    expect(from).not.toHaveBeenCalled();
  });

  it('404s on an attempt id that does not parse', async () => {
    const error = await rejected(createIncident('x7', student, 'copy_paste', 'because'));

    expect(error.status).toBe(404);
    expect(from).not.toHaveBeenCalled();
  });

  it('404s on the attempt of another student', async () => {
    queue(running, none);

    const error = await rejected(createIncident('7', student, 'copy_paste', 'because'));

    expect(error.status).toBe(404);
    expect(tables()).toEqual(['assignments', 'student_assignment']);
  });

  it('404s for a professor who teaches none of the modules of the exam', async () => {
    queue(running, someoneElsesExam, row([{ module_id: 2 }]), row([]), row({ position: 'professor' }));

    const error = await rejected(createIncident('7', professor, 'manual_review', 'because'));

    expect(error.status).toBe(404);
    expect(callsOf('insert')).toEqual([]);
  });

  it('409s when a student reports on an attempt that is not running', async () => {
    for (const status of ['pending', 'submitted', 'auto_submitted', 'graded']) {
      calls.length = 0;
      queue(row({ id: 7, exam_id: 3, status, submitted_at: null }), owner);

      const error = await rejected(createIncident('7', student, 'copy_paste', 'because'));

      expect(error.status).toBe(409);
    }
  });

  it('still lets a student report an incident on an attempt that is running late', async () => {
    queue(running, owner, incident, none, none);

    expect((await createIncident('7', student, 'copy_paste', 'past the deadline')).id).toBe(31);
  });

  it('lets the client of a student report a second incident on an already flagged attempt', async () => {
    queue(row({ id: 7, exam_id: 3, status: 'flagged', submitted_at: null }), owner, incident, none, none);

    expect((await createIncident('7', student, 'devtools', 'opened devtools')).id).toBe(31);
  });

  it('drops the incident again when the link cannot be written', async () => {
    queue(running, owner, incident, fails('link exploded'), none);

    const error = await rejected(createIncident('7', student, 'copy_paste', 'because'));

    expect(error).not.toBeInstanceOf(HttpError);
    expect(error.message).toBe('link exploded');
    expect(tables()).toEqual(['assignments', 'student_assignment', 'cheatings', 'cheating_reason', 'cheatings']);
    expect(callsOf('delete')).toEqual([['delete']]);
    expect(calls.at(-1)).toEqual(['eq', 'id', 31]);
  });

  it('keeps the incident even when the attempt cannot be flagged, and logs the failure instead', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    queue(running, owner, incident, none, fails('status exploded'));

    const cheating = await createIncident('7', student, 'copy_paste', 'because');

    expect(cheating.id).toBe(31);
    expect(tables()).toEqual(['assignments', 'student_assignment', 'cheatings', 'cheating_reason', 'assignments']);
    expect(callsOf('delete')).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith('Error flagging attempt after recording a cheating incident:', 'status exploded');
    consoleError.mockRestore();
  });
});

describe('listIncidents', () => {
  it('returns the incidents of an attempt the professor manages, newest first', async () => {
    queue(
      running,
      ...teaches,
      row([{ cheating_id: 31 }, { cheating_id: 30 }]),
      row([{ id: 31, name: 'devtools' }, { id: 30, name: 'copy_paste' }])
    );

    const cheatings = await listIncidents('7', professor);

    expect(cheatings).toHaveLength(2);
    expect(tables()).toEqual(['assignments', 'exams', 'exam_module', 'module_professor', 'cheating_reason', 'cheatings']);
    expect(callsOf('in').at(-1)).toEqual(['in', 'id', [31, 30]]);
    // the attempt, the exam behind it and the incidents are all read live only
    expect(callsOf('is')).toEqual([['is', 'deleted_at', null], ['is', 'deleted_at', null], ['is', 'deleted_at', null]]);
    expect(callsOf('limit')).toEqual([['limit', 1], ['limit', 200], ['limit', 200]]);
  });

  it('404s for an examiner who is not assigned to the exam', async () => {
    queue(running, someoneElsesExam, none);

    const error = await rejected(listIncidents('7', examiner));

    expect(error.status).toBe(404);
    expect(tables()).toEqual(['assignments', 'exams', 'exam_examiner']);
  });

  it('404s once the exam itself is soft deleted', async () => {
    queue(running, none);

    const error = await rejected(listIncidents('7', professor));

    expect(error.status).toBe(404);
    expect(tables()).toEqual(['assignments', 'exams']);
  });

  it('404s when the attempt does not exist', async () => {
    queue(none);

    expect((await rejected(listIncidents('7', professor))).status).toBe(404);
  });

  it('answers with an empty list without reading the cheatings table', async () => {
    queue(running, someoneElsesExam, row({ exam_id: 3 }), row([]));

    expect(await listIncidents('7', examiner)).toEqual([]);
    expect(tables()).toEqual(['assignments', 'exams', 'exam_examiner', 'cheating_reason']);
  });
});

describe('getIncident', () => {
  it('returns the incident with the attempt it belongs to', async () => {
    queue(row({ assignment_id: 7 }), running, someoneElsesExam, row({ exam_id: 3 }), row({ id: 31, name: 'devtools', explanation: 'opened' }));

    const cheating = await getIncident('31', examiner);

    expect(cheating).toEqual({ id: 31, name: 'devtools', explanation: 'opened', assignment_id: 7 });
    expect(tables()).toEqual(['cheating_reason', 'assignments', 'exams', 'exam_examiner', 'cheatings']);
  });

  it('404s when the incident is linked to no attempt', async () => {
    queue(none);

    const error = await rejected(getIncident('31', professor));

    expect(error.status).toBe(404);
    expect(error.message).toBe('Cheating not found');
  });

  it('404s when the caller cannot see the attempt', async () => {
    queue(row({ assignment_id: 7 }), running, someoneElsesExam, none);

    const error = await rejected(getIncident('31', examiner));

    expect(error.status).toBe(404);
    expect(error.message).toBe('Cheating not found');
  });

  it('404s on an id that does not parse and when the incident is dismissed', async () => {
    expect((await rejected(getIncident('abc', professor))).status).toBe(404);
    expect(from).not.toHaveBeenCalled();

    queue(row({ assignment_id: 7 }), running, someoneElsesExam, row({ exam_id: 3 }), none);
    expect((await rejected(getIncident('31', examiner))).status).toBe(404);
  });
});

describe('dismissIncident', () => {
  it('soft deletes the incident and leaves the status of the attempt alone', async () => {
    queue(row({ assignment_id: 7 }), running, ...teaches, row({ id: 31, name: 'devtools', deleted_at: 'now', reason: 'false positive' }));

    const cheating = await dismissIncident('31', 9, 'false positive');

    expect(cheating.reason).toBe('false positive');
    expect(tables()).toEqual(['cheating_reason', 'assignments', 'exams', 'exam_module', 'module_professor', 'cheatings']);
    const [[, patch]] = callsOf('update');
    expect(patch).toEqual({ deleted_at: expect.any(String), reason: 'false positive' });
    expect(callsOf('update')).toHaveLength(1);
  });

  it('400s without a reason', async () => {
    for (const reason of [undefined, '', '  ', 'x'.repeat(1001)]) {
      expect((await rejected(dismissIncident('31', 9, reason))).status).toBe(400);
    }
    expect(from).not.toHaveBeenCalled();
  });

  it('404s for a professor who does not manage the exam', async () => {
    queue(row({ assignment_id: 7 }), running, someoneElsesExam, row([{ module_id: 2 }]), row([]), row({ position: 'professor' }));

    const error = await rejected(dismissIncident('31', 9, 'false positive'));

    expect(error.status).toBe(404);
    expect(callsOf('update')).toEqual([]);
  });

  it('404s when the incident is already dismissed', async () => {
    queue(row({ assignment_id: 7 }), running, ...teaches, none);

    expect((await rejected(dismissIncident('31', 9, 'again'))).status).toBe(404);
    expect(callsOf('is')).toContainEqual(['is', 'deleted_at', null]);
  });
});

describe('examSummary', () => {
  it('counts the live incidents of the exam per type, biggest first', async () => {
    queue(
      ...teaches,
      row([{ id: 7 }, { id: 8 }]),
      row([{ cheating_id: 31 }, { cheating_id: 32 }, { cheating_id: 33 }]),
      row([{ name: 'copy_paste' }, { name: 'devtools' }, { name: 'copy_paste' }])
    );

    const summary = await examSummary('3', professor);

    expect(summary).toEqual([{ name: 'copy_paste', count: 2 }, { name: 'devtools', count: 1 }]);
    expect(tables()).toEqual(['exams', 'exam_module', 'module_professor', 'assignments', 'cheating_reason', 'cheatings']);
    expect(callsOf('in')).toEqual([
      ['in', 'module_id', [2]],
      ['in', 'assignment_id', [7, 8]],
      ['in', 'id', [31, 32, 33]],
    ]);
  });

  it('summarises an exam the professor created without linking it to a module', async () => {
    queue(
      row({ id: 3, created_by: professor.id }),
      row([{ id: 7 }]),
      row([{ cheating_id: 31 }]),
      row([{ name: 'devtools' }])
    );

    expect(await examSummary('3', professor)).toEqual([{ name: 'devtools', count: 1 }]);
    expect(tables()).toEqual(['exams', 'assignments', 'cheating_reason', 'cheatings']);
  });

  it('404s an exam that is soft deleted', async () => {
    queue(none);

    const error = await rejected(examSummary('3', professor));

    expect(error.status).toBe(404);
    expect(error.message).toBe('Exam not found');
    expect(tables()).toEqual(['exams']);
  });

  it('400s on a missing or malformed examId', async () => {
    for (const examId of [undefined, '', 'abc', '0', ['3']]) {
      expect((await rejected(examSummary(examId, professor))).status).toBe(400);
    }
    expect(from).not.toHaveBeenCalled();
  });

  it('404s for an examiner who is not assigned to the exam', async () => {
    queue(someoneElsesExam, none);

    const error = await rejected(examSummary('3', examiner));

    expect(error.status).toBe(404);
    expect(error.message).toBe('Exam not found');
  });

  it('answers with an empty summary when the exam has no attempt or no incident', async () => {
    queue(someoneElsesExam, row({ exam_id: 3 }), row([]));
    expect(await examSummary('3', examiner)).toEqual([]);

    calls.length = 0;
    queue(someoneElsesExam, row({ exam_id: 3 }), row([{ id: 7 }]), row([]));
    expect(await examSummary('3', examiner)).toEqual([]);
    expect(tables()).toEqual(['exams', 'exam_examiner', 'assignments', 'cheating_reason']);
  });

  it('turns an unexpected database error into a plain error', async () => {
    queue(someoneElsesExam, row({ exam_id: 3 }), fails('timeout'));

    const error = await rejected(examSummary('3', examiner));

    expect(error).not.toBeInstanceOf(HttpError);
    expect(error.message).toBe('timeout');
  });
});
