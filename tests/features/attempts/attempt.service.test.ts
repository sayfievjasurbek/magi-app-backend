import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// lib/db.ts throws without env vars: a chainable fake records every call and answers from a per-table queue
const { from, rpc, calls, queue, queueError, reset } = vi.hoisted(() => {
  const calls: any[] = [];
  const queues = new Map<string, any[]>();

  const push = (table: string, result: any) => {
    const waiting = queues.get(table) ?? [];
    waiting.push(result);
    queues.set(table, waiting);
  };

  const from = vi.fn((table: string) => {
    const call: any = { table, op: 'select', filters: [] };
    calls.push(call);

    const result = () => {
      const waiting = queues.get(table) ?? [];
      return Promise.resolve(waiting.length ? waiting.shift() : { data: null, error: null });
    };

    const query: any = {
      select: (columns: string) => ((call.columns = columns), query),
      insert: (payload: any) => ((call.op = 'insert'), (call.payload = payload), query),
      update: (payload: any) => ((call.op = 'update'), (call.payload = payload), query),
      delete: () => ((call.op = 'delete'), query),
      eq: (column: string, value: any) => (call.filters.push(['eq', column, value]), query),
      neq: (column: string, value: any) => (call.filters.push(['neq', column, value]), query),
      in: (column: string, values: any) => (call.filters.push(['in', column, values]), query),
      is: (column: string, value: any) => (call.filters.push(['is', column, value]), query),
      order: (column: string, options?: any) => ((call.order = [column, options]), query),
      limit: (rows: number) => ((call.limit = rows), query),
      maybeSingle: result,
      single: result,
      then: (resolve: any, reject: any) => result().then(resolve, reject),
    };
    return query;
  });

  // the start of an attempt is one database function, queued under rpc:<name>
  const rpc = vi.fn((name: string, params: any) => {
    calls.push({ table: `rpc:${name}`, op: 'rpc', params, filters: [] });
    const waiting = queues.get(`rpc:${name}`) ?? [];
    return Promise.resolve(waiting.length ? waiting.shift() : { data: null, error: null });
  });

  return {
    from,
    rpc,
    calls,
    queue: (table: string, data: any) => push(table, { data, error: null }),
    queueError: (table: string, error: any) => push(table, { data: null, error }),
    reset: () => {
      calls.length = 0;
      queues.clear();
      from.mockClear();
      rpc.mockClear();
    },
  };
});

vi.mock('../../../lib/db.js', () => ({ database: { from, rpc } }));

import {
  startAttempt,
  listMyAttempts,
  listExamAttempts,
  listAttemptsSummary,
  getAttempt,
  syncAnswers,
  submitAttempt,
  gradeAttempt,
} from '../../../features/attempts/attempt.service.js';

const NOW = new Date('2026-09-21T10:00:00.000Z');

const EXAM = {
  id: 5,
  name: 'Algorithms',
  scheduled_start: '2026-09-21T09:00:00.000Z',
  scheduled_end: '2026-09-21T12:00:00.000Z',
  status: 'ongoing',
  max_marks: 100,
  passing_marks: 50,
};

// started at 09:30 with an hour of session: the deadline is 10:30, half an hour after NOW
const attemptRow = (overrides: Record<string, unknown> = {}) => ({
  id: 9,
  exam_id: 5,
  session_duration: 3600,
  session_duration_unit: 'seconds',
  started_at: '2026-09-21T09:30:00.000Z',
  submitted_at: null,
  auto_submitted: false,
  status: 'in_progress',
  score: 0,
  feedback: null,
  ...overrides,
});

const STUDENT = { id: 3, role: 'student' as const };
const PROFESSOR = { id: 4, role: 'professor' as const };
const EXAMINER = { id: 6, role: 'examiner' as const };

const called = (table: string, op = 'select') => calls.filter((call) => call.table === table && call.op === op);
const filter = (call: any, column: string) => call.filters.find(([, name]: [string, string]) => name === column)?.[2];

// the queries loadOwnAttempt / loadStaffAttempt make, in order
const queueOwnAttempt = (attempt = attemptRow(), exam = EXAM) => {
  queue('assignments', attempt);
  queue('student_assignment', { student_id: STUDENT.id });
  queue('exams', exam);
};

const queueStaffAttempt = (attempt = attemptRow(), exam = EXAM) => {
  queue('assignments', attempt);
  queue('exams', exam);
  queue('exam_module', [{ module_id: 2 }]);
  queue('module_professor', [{ module_id: 2 }]);
  queue('student_assignment', { student_id: STUDENT.id });
};

beforeEach(() => {
  reset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startAttempt', () => {
  const queueStartable = (exam = EXAM) => {
    queue('exams', exam);
    queue('exam_student', { exam_id: exam.id });
    queue('student_assignment', null);
  };

  it('rejects a missing or malformed examId', async () => {
    await expect(startAttempt(STUDENT.id, {})).rejects.toMatchObject({ status: 400 });
    await expect(startAttempt(STUDENT.id, { examId: 'five' })).rejects.toMatchObject({ status: 400 });
    await expect(startAttempt(STUDENT.id, { examId: 0 })).rejects.toMatchObject({ status: 400 });
    expect(from).not.toHaveBeenCalled();
  });

  it('reads only live exams and 404s an unknown one', async () => {
    queue('exams', null);

    await expect(startAttempt(STUDENT.id, { examId: 5 })).rejects.toMatchObject({ status: 404 });
    expect(called('exams')[0].filters).toContainEqual(['is', 'deleted_at', null]);
  });

  it('404s an exam the student is not assigned to', async () => {
    queue('exams', EXAM);
    queue('exam_student', null);

    await expect(startAttempt(STUDENT.id, { examId: 5 })).rejects.toMatchObject({ status: 404, message: 'Exam not found' });
  });

  it('refuses an exam that is not open', async () => {
    queue('exams', { ...EXAM, status: 'cancelled' });
    queue('exam_student', { exam_id: 5 });

    await expect(startAttempt(STUDENT.id, { examId: 5 })).rejects.toMatchObject({ status: 400, message: 'This exam is cancelled and cannot be taken' });
  });

  it('refuses to start outside the exam window', async () => {
    queue('exams', { ...EXAM, scheduled_start: '2026-09-21T11:00:00.000Z' });
    queue('exam_student', { exam_id: 5 });
    await expect(startAttempt(STUDENT.id, { examId: 5 })).rejects.toMatchObject({ status: 400, message: 'This exam has not started yet' });

    reset();
    queue('exams', { ...EXAM, scheduled_end: '2026-09-21T09:59:00.000Z' });
    queue('exam_student', { exam_id: 5 });
    await expect(startAttempt(STUDENT.id, { examId: 5 })).rejects.toMatchObject({ status: 400, message: 'This exam is over' });
  });

  it('409s a second attempt at the same exam', async () => {
    queue('exams', EXAM);
    queue('exam_student', { exam_id: 5 });
    queue('student_assignment', { assignment_id: 9 });

    await expect(startAttempt(STUDENT.id, { examId: 5 })).rejects.toMatchObject({ status: 409 });
    expect(called('assignments', 'insert')).toHaveLength(0);
  });

  it('refuses an exam without live questions', async () => {
    queueStartable();
    queue('exam_question', [{ question_id: 7, position: 1 }]);
    queue('questions', []);

    await expect(startAttempt(STUDENT.id, { examId: 5 })).rejects.toMatchObject({ status: 400, message: 'This exam has no questions yet' });
  });

  it('starts the whole attempt in one database call and reads it back', async () => {
    queueStartable();
    queue('exam_question', [{ question_id: 7 }, { question_id: 8 }]);
    queue('questions', [
      { id: 7, expected_duration: 5, expected_duration_unit: 'minutes' },
      { id: 8, expected_duration: 120, expected_duration_unit: 'seconds' },
    ]);
    queue('rpc:start_attempt', attemptRow({ session_duration: 420, started_at: NOW.toISOString() }));

    const attempt = await startAttempt(STUDENT.id, { examId: 5 });

    // 5 minutes + 120 seconds, well inside the two hours left of the window
    expect(rpc).toHaveBeenCalledWith('start_attempt', {
      param_student_id: STUDENT.id,
      param_exam_id: 5,
      param_session_duration: 420,
      param_started_at: NOW.toISOString(),
    });
    // the four writes belong to the database function now
    expect(called('assignments', 'insert')).toHaveLength(0);
    expect(called('question_assignment', 'insert')).toHaveLength(0);
    expect(called('assignment_permitted_url', 'insert')).toHaveLength(0);
    expect(attempt.remaining_seconds).toBe(420);
    expect(attempt).not.toHaveProperty('score');
  });

  it('caps the session at what is left of the exam window', async () => {
    queueStartable({ ...EXAM, scheduled_end: '2026-09-21T10:10:00.000Z' });
    queue('exam_question', [{ question_id: 7 }]);
    queue('questions', [{ id: 7, expected_duration: 2, expected_duration_unit: 'hours' }]);
    queue('rpc:start_attempt', attemptRow());

    await startAttempt(STUDENT.id, { examId: 5 });

    expect(rpc.mock.calls[0][1].param_session_duration).toBe(600);
  });

  it('falls back to the rest of the window when the questions expect no time', async () => {
    queueStartable();
    queue('exam_question', [{ question_id: 7 }]);
    queue('questions', [{ id: 7, expected_duration: 0, expected_duration_unit: 'seconds' }]);
    queue('rpc:start_attempt', attemptRow());

    await startAttempt(STUDENT.id, { examId: 5 });

    expect(rpc.mock.calls[0][1].param_session_duration).toBe(2 * 60 * 60);
  });

  it('409s when the start itself races another attempt', async () => {
    queueStartable();
    queue('exam_question', [{ question_id: 7 }]);
    queue('questions', [{ id: 7, expected_duration: 60, expected_duration_unit: 'seconds' }]);
    queueError('rpc:start_attempt', { code: '23505', message: 'duplicate key value violates unique constraint' });

    await expect(startAttempt(STUDENT.id, { examId: 5 })).rejects.toMatchObject({ status: 409 });
  });

  it('turns any other failure of the start into a 500', async () => {
    queueStartable();
    queue('exam_question', [{ question_id: 7 }]);
    queue('questions', [{ id: 7, expected_duration: 60, expected_duration_unit: 'seconds' }]);
    queueError('rpc:start_attempt', { code: '23503', message: 'insert or update on table violates foreign key constraint' });

    await expect(startAttempt(STUDENT.id, { examId: 5 })).rejects.not.toHaveProperty('status');
  });
});

describe('getAttempt as a student', () => {
  it('404s an id that cannot be one', async () => {
    await expect(getAttempt(STUDENT, null)).rejects.toMatchObject({ status: 404 });
    expect(from).not.toHaveBeenCalled();
  });

  it('404s an attempt of another student', async () => {
    queue('assignments', attemptRow());
    queue('student_assignment', null);

    await expect(getAttempt(STUDENT, 9)).rejects.toMatchObject({ status: 404, message: 'Attempt not found' });
    expect(filter(called('student_assignment')[0], 'student_id')).toBe(STUDENT.id);
  });

  it('never reads is_correct and returns the saved answers in their attempt order', async () => {
    queueOwnAttempt();
    queue('question_assignment', [
      { question_id: 8, position: 1, answer: 'b', typing_duration: 30, typing_duration_unit: 'seconds', text_typed: 1, text_edited: 0, text_pasted: 0, last_synced_at: null, started_at: null, answered_at: null, marks_awarded: 10 },
      { question_id: 7, position: 2, answer: '', typing_duration: 0, typing_duration_unit: 'seconds', text_typed: 0, text_edited: 0, text_pasted: 0, last_synced_at: null, started_at: null, answered_at: null, marks_awarded: 0 },
    ]);
    queue('questions', [
      { id: 7, title: 'Q7', question: 'why', question_type: 'essay', expected_duration: 600, expected_duration_unit: 'seconds' },
      { id: 8, title: 'Q8', question: 'pick', question_type: 'multiple_choice', expected_duration: 60, expected_duration_unit: 'seconds' },
    ]);
    queue('question_options', [{ id: 21, question_id: 8, option_text: 'a' }, { id: 22, question_id: 8, option_text: 'b' }]);
    queue('question_assignment_option', [{ question_id: 8, option_id: 22 }]);
    queue('exam_question', [{ question_id: 7, marks: 30 }, { question_id: 8, marks: 10 }]);
    queue('assignment_permitted_url', [{ permitted_url_id: 11 }]);
    queue('permitted_urls', [{ id: 11, url: 'https://docs.magi.edu' }]);

    const attempt = await getAttempt(STUDENT, 9) as any;

    expect(called('question_options')[0].columns).toBe('id, question_id, option_text');
    expect(attempt.questions.map((question: any) => question.question_id)).toEqual([8, 7]);
    expect(attempt.questions[0].options).toEqual([{ id: 21, option_text: 'a' }, { id: 22, option_text: 'b' }]);
    expect(attempt.questions[0].selected_option_ids).toEqual([22]);
    expect(attempt.questions[0].marks).toBe(10);
    // the marks are not the student's business while the attempt is not graded
    expect(attempt.questions[0]).not.toHaveProperty('marks_awarded');
    expect(attempt.questions[0]).not.toHaveProperty('paste_ratio');
    expect(attempt).not.toHaveProperty('score');
    expect(attempt.remaining_seconds).toBe(1800);
    expect(attempt.permitted_urls).toEqual([{ id: 11, url: 'https://docs.magi.edu' }]);
  });

  it('never shows the student that the attempt is flagged', async () => {
    queueOwnAttempt(attemptRow({ status: 'flagged' }));

    const running = await getAttempt(STUDENT, 9);
    expect(running.status).toBe('in_progress');

    reset();
    queueOwnAttempt(attemptRow({ status: 'flagged', submitted_at: '2026-09-21T09:50:00.000Z' }));
    expect((await getAttempt(STUDENT, 9)).status).toBe('submitted');

    reset();
    queueOwnAttempt(attemptRow({ status: 'flagged', submitted_at: '2026-09-21T09:50:00.000Z', auto_submitted: true }));
    expect((await getAttempt(STUDENT, 9)).status).toBe('auto_submitted');
  });

  it('shows the score and the marks once the attempt is graded', async () => {
    queueOwnAttempt(attemptRow({ status: 'graded', submitted_at: '2026-09-21T09:50:00.000Z', score: 60, feedback: 'good' }));
    queue('question_assignment', [{ question_id: 8, position: 1, answer: 'b', typing_duration: 0, typing_duration_unit: 'seconds', text_typed: 0, text_edited: 0, text_pasted: 0, last_synced_at: null, started_at: null, answered_at: null, marks_awarded: 10 }]);
    queue('questions', [{ id: 8, title: 'Q8', question: 'pick', question_type: 'multiple_choice', expected_duration: 60, expected_duration_unit: 'seconds' }]);

    const attempt = await getAttempt(STUDENT, 9);

    expect(attempt).toMatchObject({ score: 60, passed: true, feedback: 'good', remaining_seconds: 0 });
    expect(attempt.questions[0].marks_awarded).toBe(10);
  });

  it('auto submits an attempt whose time ran out before answering', async () => {
    queueOwnAttempt(attemptRow({ started_at: '2026-09-21T08:30:00.000Z' }));
    queue('exam_question', [{ question_id: 7, marks: 30 }]);
    queue('questions', [{ id: 7, question_type: 'essay' }]);
    queue('assignments', [attemptRow({ started_at: '2026-09-21T08:30:00.000Z', status: 'auto_submitted', submitted_at: NOW.toISOString(), auto_submitted: true })]);

    const attempt = await getAttempt(STUDENT, 9);

    expect(called('assignments', 'update')[0].payload).toMatchObject({ status: 'auto_submitted', auto_submitted: true, score: 0 });
    expect(attempt.status).toBe('auto_submitted');
    expect(attempt.remaining_seconds).toBe(0);
  });
});

describe('getAttempt as staff', () => {
  it('404s an exam the examiner is not assigned to', async () => {
    queue('assignments', attemptRow());
    queue('exams', EXAM);
    queue('exam_examiner', null);

    await expect(getAttempt(EXAMINER, 9)).rejects.toMatchObject({ status: 404 });
  });

  it('404s an exam the professor does not teach a module of', async () => {
    queue('assignments', attemptRow());
    queue('exams', EXAM);
    queue('exam_module', [{ module_id: 2 }]);
    queue('module_professor', []);

    await expect(getAttempt(PROFESSOR, 9)).rejects.toMatchObject({ status: 404 });
  });

  it('gives the professor the correct options, the metrics and the paste ratio', async () => {
    queueStaffAttempt(attemptRow({ status: 'submitted', submitted_at: '2026-09-21T09:50:00.000Z' }));
    queue('users', { id: 3, first_name: 'Sam', last_name: 'Lee', email: 'sam@magi.edu' });
    queue('question_assignment', [{ question_id: 8, position: 1, answer: 'pasted text', typing_duration: 90, typing_duration_unit: 'seconds', text_typed: 30, text_edited: 2, text_pasted: 70, last_synced_at: null, started_at: null, answered_at: null, marks_awarded: 10 }]);
    queue('questions', [{ id: 8, title: 'Q8', question: 'pick', question_type: 'multiple_choice', expected_duration: 60, expected_duration_unit: 'seconds' }]);
    queue('question_options', [{ id: 21, question_id: 8, option_text: 'a', is_correct: true }]);
    queue('question_assignment_option', [{ question_id: 8, option_id: 21 }]);
    queue('exam_question', [{ question_id: 8, marks: 10 }]);

    const attempt = await getAttempt(PROFESSOR, 9) as any;

    expect(called('question_options')[0].columns).toBe('id, question_id, option_text, is_correct');
    expect(attempt.questions[0].options).toEqual([{ id: 21, option_text: 'a', is_correct: true }]);
    expect(attempt.questions[0].paste_ratio).toBe(0.7);
    expect(attempt.questions[0].marks_awarded).toBe(10);
    expect(attempt.student).toMatchObject({ id: 3, email: 'sam@magi.edu' });
    expect(attempt).toMatchObject({ score: 0, passed: null });
    expect(attempt).not.toHaveProperty('permitted_urls');
    expect(attempt.completion).toEqual({ answered: 1, total: 1, marks_answered: 10, marks_total: 10 });
  });

  it('counts an unanswered question toward the total but not toward what was answered', async () => {
    queueStaffAttempt(attemptRow({ status: 'submitted', submitted_at: '2026-09-21T09:50:00.000Z' }));
    queue('users', { id: 3, first_name: 'Sam', last_name: 'Lee', email: 'sam@magi.edu' });
    queue('question_assignment', [
      { question_id: 8, position: 1, answer: 'done', typing_duration: 0, typing_duration_unit: 'seconds', text_typed: 0, text_edited: 0, text_pasted: 0, last_synced_at: null, started_at: null, answered_at: null, marks_awarded: 0 },
      { question_id: 9, position: 2, answer: '', typing_duration: 0, typing_duration_unit: 'seconds', text_typed: 0, text_edited: 0, text_pasted: 0, last_synced_at: null, started_at: null, answered_at: null, marks_awarded: 0 },
    ]);
    queue('questions', [
      { id: 8, title: 'Q8', question: 'pick', question_type: 'short_answer', expected_duration: 60, expected_duration_unit: 'seconds' },
      { id: 9, title: 'Q9', question: 'write', question_type: 'short_answer', expected_duration: 60, expected_duration_unit: 'seconds' },
    ]);
    queue('question_options', []);
    queue('question_assignment_option', []);
    queue('exam_question', [{ question_id: 8, marks: 10 }, { question_id: 9, marks: 15 }]);

    const attempt = await getAttempt(PROFESSOR, 9) as any;

    expect(attempt.completion).toEqual({ answered: 1, total: 2, marks_answered: 10, marks_total: 25 });
  });

  it('lets the professor who created the exam in even when it is linked to no module', async () => {
    queue('assignments', attemptRow({ status: 'submitted', submitted_at: '2026-09-21T09:50:00.000Z' }));
    queue('exams', { ...EXAM, created_by: PROFESSOR.id });
    queue('student_assignment', { student_id: STUDENT.id });
    queue('users', { id: 3, first_name: 'Sam', last_name: null, email: 'sam@magi.edu' });

    const attempt = await getAttempt(PROFESSOR, 9);

    expect(attempt.id).toBe(9);
    expect(called('exam_module')).toHaveLength(0);
  });

  it('404s an attempt whose exam is soft deleted', async () => {
    queue('assignments', attemptRow());
    queue('exams', null);

    await expect(getAttempt(PROFESSOR, 9)).rejects.toMatchObject({ status: 404, message: 'Attempt not found' });
  });

  it('reads a flagged attempt like any other', async () => {
    queue('assignments', attemptRow({ status: 'flagged', submitted_at: '2026-09-21T09:50:00.000Z' }));
    queue('exams', EXAM);
    queue('exam_examiner', { exam_id: 5 });
    queue('student_assignment', { student_id: STUDENT.id });
    queue('users', { id: 3, first_name: 'Sam', last_name: null, email: 'sam@magi.edu' });

    const attempt = await getAttempt(EXAMINER, 9);
    expect(attempt.status).toBe('flagged');
  });
});

describe('listMyAttempts', () => {
  it('returns nothing when the student never sat an exam', async () => {
    queue('student_assignment', []);
    expect(await listMyAttempts(STUDENT.id)).toEqual([]);
    expect(called('assignments')).toHaveLength(0);
  });

  it('joins each attempt to its exam, newest first', async () => {
    queue('student_assignment', [{ assignment_id: 9 }, { assignment_id: 10 }]);
    queue('assignments', [attemptRow({ id: 10, status: 'graded', score: 40, submitted_at: '2026-09-20T10:00:00.000Z' }), attemptRow()]);
    queue('exams', [EXAM]);

    const attempts = await listMyAttempts(STUDENT.id);

    expect(called('assignments')[0].order).toEqual(['id', { ascending: false }]);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ id: 10, score: 40, passed: false });
    expect(attempts[1]).not.toHaveProperty('score');
    expect(attempts[1].exam).toMatchObject({ id: 5, name: 'Algorithms', passing_marks: 50 });
  });
});

describe('listExamAttempts', () => {
  it('needs an examId and a known status', async () => {
    await expect(listExamAttempts(PROFESSOR, {})).rejects.toMatchObject({ status: 400 });
    await expect(listExamAttempts(PROFESSOR, { examId: 5, status: 'done' })).rejects.toMatchObject({ status: 400 });
    expect(from).not.toHaveBeenCalled();
  });

  it('404s an exam the caller does not manage', async () => {
    queue('exams', EXAM);
    queue('exam_module', []);

    await expect(listExamAttempts(PROFESSOR, { examId: 5 })).rejects.toMatchObject({ status: 404 });
  });

  it('filters by status and names the student of every attempt', async () => {
    queue('exams', EXAM);
    queue('exam_examiner', { exam_id: 5 });
    queue('assignments', [attemptRow({ status: 'flagged' })]);
    queue('student_assignment', [{ assignment_id: 9, student_id: 3 }]);
    queue('users', [{ id: 3, first_name: 'Sam', last_name: 'Lee', email: 'sam@magi.edu' }]);

    const attempts = await listExamAttempts(EXAMINER, { examId: 5, status: 'flagged' });

    expect(called('assignments')[0].filters).toContainEqual(['eq', 'status', 'flagged']);
    expect(attempts[0]).toMatchObject({ id: 9, status: 'flagged', score: 0, passed: null });
    expect(attempts[0].student).toMatchObject({ id: 3, first_name: 'Sam' });
  });

  it('reads at most one page of attempts, so the lists it builds from stay bounded', async () => {
    queue('exams', EXAM);
    queue('exam_module', [{ module_id: 2 }]);
    queue('module_professor', [{ module_id: 2 }]);
    queue('assignments', []);

    await listExamAttempts(PROFESSOR, { examId: 5 });

    expect(called('assignments')[0].limit).toBe(500);
  });
});

describe('listAttemptsSummary', () => {
  it('counts attempts per exam the professor manages, across both created and module-linked exams', async () => {
    queue('exams', [{ id: 5 }]); // created_by
    queue('module_professor', [{ module_id: 2 }]); // taught
    queue('exam_module', [{ exam_id: 7 }]); // linked via a taught module
    queue('exams', [{ id: 7 }]); // live check on the linked-but-not-created exam
    queue('assignments', [
      { exam_id: 5, status: 'graded' },
      { exam_id: 5, status: 'submitted' },
      { exam_id: 5, status: 'in_progress' },
      { exam_id: 7, status: 'flagged' },
    ]);

    const summary = await listAttemptsSummary(PROFESSOR.id);

    expect(summary).toEqual(
      expect.arrayContaining([
        { exam_id: 5, students: 3, awaiting: 1, graded: 1 },
        { exam_id: 7, students: 1, awaiting: 1, graded: 0 },
      ]),
    );
    expect(summary).toHaveLength(2);
  });

  it('answers empty, with no attempts query, when the professor manages no exams', async () => {
    queue('exams', []);
    queue('module_professor', []);

    expect(await listAttemptsSummary(PROFESSOR.id)).toEqual([]);
    expect(called('assignments')).toHaveLength(0);
  });

  it('counts an exam with zero attempts as zero, not missing', async () => {
    queue('exams', [{ id: 5 }]);
    queue('module_professor', []);
    queue('assignments', []);

    expect(await listAttemptsSummary(PROFESSOR.id)).toEqual([{ exam_id: 5, students: 0, awaiting: 0, graded: 0 }]);
  });
});

describe('syncAnswers', () => {
  const queueOpenAttempt = () => {
    queueOwnAttempt();
    queue('question_assignment', [{ question_id: 7 }, { question_id: 8 }]);
  };

  it('refuses to write into an attempt that is not open', async () => {
    queueOwnAttempt(attemptRow({ status: 'submitted', submitted_at: '2026-09-21T09:50:00.000Z' }));

    await expect(syncAnswers(STUDENT.id, 9, { answers: [{ questionId: 7, answer: 'x' }] })).rejects.toMatchObject({
      status: 409,
      message: 'This attempt is not in progress',
    });
    expect(called('question_assignment', 'update')).toHaveLength(0);
  });

  it('auto submits an attempt that ran out of time and says so', async () => {
    queueOwnAttempt(attemptRow({ started_at: '2026-09-21T08:30:00.000Z' }));
    queue('exam_question', []);
    queue('assignments', [attemptRow({ status: 'graded', submitted_at: NOW.toISOString(), auto_submitted: true })]);

    await expect(syncAnswers(STUDENT.id, 9, { answers: [{ questionId: 7, answer: 'x' }] })).rejects.toMatchObject({
      status: 409,
      message: 'Time is up: this attempt has been submitted automatically',
    });
  });

  it('needs a non-empty array of answers', async () => {
    queueOwnAttempt();
    await expect(syncAnswers(STUDENT.id, 9, {})).rejects.toMatchObject({ status: 400 });

    reset();
    queueOwnAttempt();
    await expect(syncAnswers(STUDENT.id, 9, { answers: [] })).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a question that is not part of the attempt', async () => {
    queueOpenAttempt();

    await expect(syncAnswers(STUDENT.id, 9, { answers: [{ questionId: 99, answer: 'x' }] })).rejects.toMatchObject({
      status: 400,
      message: 'Question 99 is not part of this attempt',
    });
  });

  it('rejects malformed metrics before writing anything', async () => {
    queueOpenAttempt();
    await expect(syncAnswers(STUDENT.id, 9, { answers: [{ questionId: 7, answer: 'ok' }, { questionId: 8, textPasted: -1 }] }))
      .rejects.toMatchObject({ status: 400, message: 'textPasted must be a whole number of zero or more' });
    expect(called('question_assignment', 'update')).toHaveLength(0);

    reset();
    queueOpenAttempt();
    await expect(syncAnswers(STUDENT.id, 9, { answers: [{ questionId: 7, answer: 12 }] })).rejects.toMatchObject({ status: 400, message: 'answer must be a string' });

    reset();
    queueOpenAttempt();
    await expect(syncAnswers(STUDENT.id, 9, { answers: [{ questionId: 7, typingDurationUnit: 'weeks' }] })).rejects.toMatchObject({ status: 400 });

    reset();
    queueOpenAttempt();
    await expect(syncAnswers(STUDENT.id, 9, { answers: [{ questionId: 7, answeredAt: 'yesterday' }] })).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an option that belongs to another question', async () => {
    queueOpenAttempt();
    queue('question_options', [{ id: 21, question_id: 8 }]);

    await expect(syncAnswers(STUDENT.id, 9, { answers: [{ questionId: 7, optionIds: [21] }] })).rejects.toMatchObject({
      status: 400,
      message: 'Option 21 does not belong to question 7',
    });
    expect(called('question_assignment_option', 'insert')).toHaveLength(0);
  });

  it('writes the answer, the metrics and replaces the chosen options', async () => {
    queueOpenAttempt();
    queue('question_options', [{ id: 21, question_id: 8 }, { id: 22, question_id: 8 }]);

    const result = await syncAnswers(STUDENT.id, 9, {
      answers: [
        { questionId: 7, answer: 'an essay', typingDuration: 90, textTyped: 40, textEdited: 3, textPasted: 5, startedAt: '2026-09-21T09:40:00.000Z' },
        { questionId: 8, optionIds: [21, 22] },
      ],
    });

    const [essay, choice] = called('question_assignment', 'update');
    expect(essay.payload).toMatchObject({
      answer: 'an essay',
      typing_duration: 90,
      text_typed: 40,
      text_edited: 3,
      text_pasted: 5,
      started_at: '2026-09-21T09:40:00.000Z',
      answered_at: NOW.toISOString(),
      last_synced_at: NOW.toISOString(),
    });
    expect(filter(essay, 'question_id')).toBe(7);
    expect(choice.payload).not.toHaveProperty('answer');
    expect(called('question_assignment_option', 'delete')).toHaveLength(1);
    expect(called('question_assignment_option', 'insert')[0].payload).toEqual([
      { assignment_id: 9, question_id: 8, option_id: 21 },
      { assignment_id: 9, question_id: 8, option_id: 22 },
    ]);
    expect(result).toEqual({ synced: 2, remaining_seconds: 1800 });
  });

  it('clears the chosen options when an empty list is sent', async () => {
    queueOpenAttempt();

    await syncAnswers(STUDENT.id, 9, { answers: [{ questionId: 8, optionIds: [] }] });

    expect(called('question_assignment_option', 'delete')).toHaveLength(1);
    expect(called('question_assignment_option', 'insert')).toHaveLength(0);
  });

  it('accepts the answers of a flagged attempt that is still running', async () => {
    queueOwnAttempt(attemptRow({ status: 'flagged' }));
    queue('question_assignment', [{ question_id: 7 }]);

    const result = await syncAnswers(STUDENT.id, 9, { answers: [{ questionId: 7, answer: 'x' }] });
    expect(result.synced).toBe(1);
  });
});

describe('submitAttempt', () => {
  it('409s an attempt that was already submitted', async () => {
    queueOwnAttempt(attemptRow({ status: 'submitted', submitted_at: '2026-09-21T09:50:00.000Z' }));

    await expect(submitAttempt(STUDENT.id, 9)).rejects.toMatchObject({ status: 409 });
    expect(called('assignments', 'update')).toHaveLength(0);
  });

  it('marks the objective answers all or nothing and grades an exam without manual questions', async () => {
    queueOwnAttempt();
    queue('exam_question', [{ question_id: 7, marks: 10 }, { question_id: 8, marks: 20 }]);
    queue('questions', [{ id: 7, question_type: 'multiple_choice' }, { id: 8, question_type: 'true_false' }]);
    queue('question_options', [
      { id: 21, question_id: 7 },
      { id: 22, question_id: 7 },
      { id: 31, question_id: 8 },
    ]);
    // question 7 needs both of its correct options, only one was chosen
    queue('question_assignment_option', [{ question_id: 7, option_id: 21 }, { question_id: 8, option_id: 31 }]);
    queue('assignments', [attemptRow({ status: 'graded', submitted_at: NOW.toISOString(), score: 20 })]);

    const { attempt, message } = await submitAttempt(STUDENT.id, 9);

    const marks = called('question_assignment', 'update').map((call) => [filter(call, 'question_id'), call.payload.marks_awarded]);
    expect(marks).toEqual([[7, 0], [8, 20]]);
    expect(called('assignments', 'update')[0].payload).toMatchObject({ status: 'graded', auto_submitted: false, score: 20 });
    expect(attempt).toMatchObject({ status: 'graded', score: 20, passed: false });
    expect(message).toBe('Your answers have been submitted');
  });

  it('waits for a professor when the exam has a question to read', async () => {
    queueOwnAttempt();
    queue('exam_question', [{ question_id: 7, marks: 10 }]);
    queue('questions', [{ id: 7, question_type: 'essay' }]);
    queue('assignments', [attemptRow({ status: 'submitted', submitted_at: NOW.toISOString() })]);

    await submitAttempt(STUDENT.id, 9);

    expect(called('assignments', 'update')[0].payload).toMatchObject({ status: 'submitted', score: 0 });
    expect(called('question_assignment', 'update')).toHaveLength(0);
  });

  it('never awards more than the exam allows', async () => {
    queueOwnAttempt(attemptRow(), { ...EXAM, max_marks: 15 });
    queue('exam_question', [{ question_id: 7, marks: 20 }]);
    queue('questions', [{ id: 7, question_type: 'true_false' }]);
    queue('question_options', [{ id: 21, question_id: 7 }]);
    queue('question_assignment_option', [{ question_id: 7, option_id: 21 }]);
    queue('assignments', [attemptRow({ status: 'graded', score: 15 })]);

    await submitAttempt(STUDENT.id, 9);

    expect(called('assignments', 'update')[0].payload.score).toBe(15);
  });

  it('submits a late attempt automatically', async () => {
    queueOwnAttempt(attemptRow({ started_at: '2026-09-21T08:30:00.000Z' }));
    queue('exam_question', []);
    queue('assignments', [attemptRow({ status: 'graded', auto_submitted: true, submitted_at: NOW.toISOString() })]);

    const { message } = await submitAttempt(STUDENT.id, 9);

    expect(called('assignments', 'update')[0].payload).toMatchObject({ auto_submitted: true });
    expect(message).toBe('Time was up: this attempt has been submitted automatically');
  });

  it('answers the student of a flagged attempt with submitted while the row stays flagged', async () => {
    queueOwnAttempt(attemptRow({ status: 'flagged' }));
    queue('exam_question', []);
    // the guarded update (status.neq('flagged')) matches nothing - the row is already flagged
    queue('assignments', []);
    queue('assignments', attemptRow({ status: 'flagged', submitted_at: NOW.toISOString() }));

    const { attempt } = await submitAttempt(STUDENT.id, 9);

    const updates = called('assignments', 'update');
    // no questions at all means hasManual is false, so the natural (pre-flag-check) status is 'graded'
    expect(updates[0].payload).toMatchObject({ status: 'graded' });
    expect(updates[1].payload).not.toHaveProperty('status');
    expect(attempt.status).toBe('submitted');
  });

  it('keeps a flagged attempt flagged so it still gets reviewed', async () => {
    queueOwnAttempt(attemptRow({ status: 'flagged' }));
    queue('exam_question', [{ question_id: 7, marks: 10 }]);
    queue('questions', [{ id: 7, question_type: 'true_false' }]);
    queue('question_options', [{ id: 21, question_id: 7 }]);
    queue('question_assignment_option', [{ question_id: 7, option_id: 21 }]);
    // the guarded update (status.neq('flagged')) matches nothing - the row is already flagged
    queue('assignments', []);
    queue('assignments', attemptRow({ status: 'flagged', submitted_at: NOW.toISOString(), score: 10 }));

    await submitAttempt(STUDENT.id, 9);

    const updates = called('assignments', 'update');
    expect(updates[1].payload).toMatchObject({ score: 10 });
    expect(updates[1].payload).not.toHaveProperty('status');
  });

  it('a concurrent flag between reading the attempt and submitting it is not clobbered', async () => {
    // the in-memory attempt looks in_progress (read before the race), but the row is actually
    // flagged in the DB by the time finishAttempt's guarded update runs
    queueOwnAttempt(attemptRow({ status: 'in_progress' }));
    queue('exam_question', []);
    queue('assignments', []);
    queue('assignments', attemptRow({ status: 'flagged', submitted_at: NOW.toISOString() }));

    const { attempt } = await submitAttempt(STUDENT.id, 9);

    const updates = called('assignments', 'update');
    expect(updates).toHaveLength(2);
    expect(updates[1].payload).not.toHaveProperty('status');
    expect(attempt.status).toBe('submitted');
  });
});

describe('gradeAttempt', () => {
  const SUBMITTED = attemptRow({ status: 'submitted', submitted_at: '2026-09-21T09:50:00.000Z' });

  const queueGradable = (attempt = SUBMITTED, exam = EXAM) => {
    queueStaffAttempt(attempt, exam);
    queue('exam_question', [{ question_id: 7, marks: 30 }, { question_id: 8, marks: 20 }]);
    queue('questions', [{ id: 7, question_type: 'essay' }, { id: 8, question_type: 'multiple_choice' }]);
  };

  it('404s an attempt of an exam the professor does not manage', async () => {
    queue('assignments', SUBMITTED);
    queue('exams', EXAM);
    queue('exam_module', [{ module_id: 2 }]);
    queue('module_professor', []);

    await expect(gradeAttempt(PROFESSOR.id, 9, { marks: [] })).rejects.toMatchObject({ status: 404 });
  });

  it('409s an attempt that is still running', async () => {
    queueStaffAttempt(attemptRow());

    await expect(gradeAttempt(PROFESSOR.id, 9, { marks: [] })).rejects.toMatchObject({ status: 409, message: 'This attempt has not been submitted yet' });
  });

  it('refuses marks for a question that is graded automatically', async () => {
    queueGradable();

    await expect(gradeAttempt(PROFESSOR.id, 9, { marks: [{ questionId: 8, marks: 5 }] })).rejects.toMatchObject({
      status: 400,
      message: 'Question 8 is not graded by hand',
    });
    expect(called('question_assignment', 'update')).toHaveLength(0);
  });

  it('refuses more marks than the question is worth', async () => {
    queueGradable();

    await expect(gradeAttempt(PROFESSOR.id, 9, { marks: [{ questionId: 7, marks: 31 }] })).rejects.toMatchObject({
      status: 400,
      message: 'Question 7 is worth at most 30 marks',
    });

    reset();
    queueGradable();
    await expect(gradeAttempt(PROFESSOR.id, 9, { marks: [{ questionId: 7, marks: -1 }] })).rejects.toMatchObject({ status: 400 });
  });

  it('stores the marks, totals every answer and reports pass or fail', async () => {
    queueGradable();
    queue('question_assignment', null); // the update of question 7
    queue('question_assignment', [{ marks_awarded: 25 }, { marks_awarded: 20 }]);
    queue('assignments', attemptRow({ status: 'graded', submitted_at: SUBMITTED.submitted_at, score: 45, feedback: 'nearly' }));
    queue('users', { id: 3, first_name: 'Sam', last_name: 'Lee', email: 'sam@magi.edu' });

    const attempt = await gradeAttempt(PROFESSOR.id, 9, { marks: [{ questionId: 7, marks: 25 }], feedback: 'nearly' });

    expect(called('question_assignment', 'update')[0].payload).toEqual({ marks_awarded: 25 });
    expect(called('assignments', 'update')[0].payload).toMatchObject({ score: 45, status: 'graded', feedback: 'nearly' });
    expect(attempt).toMatchObject({ status: 'graded', score: 45, passed: false, feedback: 'nearly' });
    expect(attempt.student).toMatchObject({ id: 3 });
  });

  it('never totals above the marks of the exam and regrades a graded attempt', async () => {
    queueGradable(attemptRow({ status: 'graded', submitted_at: SUBMITTED.submitted_at, score: 10 }), { ...EXAM, max_marks: 40 });
    queue('question_assignment', null);
    queue('question_assignment', [{ marks_awarded: 30 }, { marks_awarded: 20 }]);
    queue('assignments', attemptRow({ status: 'graded', score: 40 }));
    queue('users', null);

    const attempt = await gradeAttempt(PROFESSOR.id, 9, { marks: [{ questionId: 7, marks: 30 }] });

    expect(called('assignments', 'update')[0].payload.score).toBe(40);
    expect(attempt.passed).toBe(false);
    expect(attempt.student).toBeNull();
  });

  it('grades a flagged attempt and leaves the feedback alone when none is sent', async () => {
    queueGradable(attemptRow({ status: 'flagged', submitted_at: SUBMITTED.submitted_at }));
    queue('question_assignment', null);
    queue('question_assignment', [{ marks_awarded: 30 }, { marks_awarded: 20 }]);
    queue('assignments', attemptRow({ status: 'graded', score: 50 }));
    queue('users', null);

    const attempt = await gradeAttempt(PROFESSOR.id, 9, { marks: [{ questionId: 7, marks: 30 }] });

    expect(called('assignments', 'update')[0].payload).not.toHaveProperty('feedback');
    expect(attempt).toMatchObject({ status: 'graded', score: 50, passed: true });
  });
});
