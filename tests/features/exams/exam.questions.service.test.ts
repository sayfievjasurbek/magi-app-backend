import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type Role, type TokenPayload } from '../../../lib/types.js';

// same chainable fake as exam.service.test.ts: each awaited query takes the next queued result
const { from, queue, calls } = vi.hoisted(() => {
  const queue: any[] = [];
  const calls: { table: string; method: string; args: any[] }[] = [];
  const methods = ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'is', 'order', 'limit', 'maybeSingle', 'single'];
  const from = vi.fn((table: string) => {
    const builder: any = {
      then: (resolve: (value: unknown) => unknown) => resolve(queue.length ? queue.shift() : { data: null, error: null }),
    };
    for (const method of methods) {
      builder[method] = (...args: any[]) => {
        calls.push({ table, method, args });
        return builder;
      };
    };
    return builder;
  });
  return { from, queue, calls };
});

vi.mock('../../../lib/db.js', () => ({ database: { from } }));

import {
  listExamQuestions,
  attachQuestion,
  updateExamQuestion,
  reorderQuestions,
  detachQuestion,
  listEventCatalog,
  attachEvent,
  detachEvent,
  addPermittedUrl,
  removePermittedUrl,
} from '../../../features/exams/exam.service.js';

const rows = (data: unknown) => ({ data, error: null });
const duplicate = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };

const asUser = (id: number, role: Role): TokenPayload =>
  ({ id, first_name: 'Test', last_name: null, email: 'test@magi', role, iat: 0, exp: 0 });

const argsOf = (table: string, method: string) => calls.filter((call) => call.table === table && call.method === method).map((call) => call.args);

const ownedExam = () => rows({ id: 1, created_by: 7, max_marks: 10 });
const noAttempts = () => rows([]);

beforeEach(() => {
  queue.length = 0;
  calls.length = 0;
  from.mockClear();
});

describe('listExamQuestions', () => {
  it('lets an assigned examiner see the options with is_correct', async () => {
    queue.push(
      rows({ id: 1, max_marks: 10 }),
      rows({ exam_id: 1 }),
      rows([{ question_id: 11, position: 1, marks: 4 }]),
      rows([{ id: 11, title: 'Normal forms' }]),
      rows([{ id: 21, question_id: 11, option_text: '3NF', is_correct: true }])
    );

    const result = await listExamQuestions(asUser(8, 'examiner'), 1);

    expect(result.questions[0].options[0].is_correct).toBe(true);
    expect(result).toMatchObject({ marks_total: 4, max_marks: 10 });
  });

  it('404s an exam the examiner is not assigned to', async () => {
    queue.push(rows({ id: 1, max_marks: 10 }), rows(null));

    await expect(listExamQuestions(asUser(8, 'examiner'), 1)).rejects.toMatchObject({ status: 404 });
  });
});

describe('attachQuestion', () => {
  it('refuses a questionId that is not an id', async () => {
    await expect(attachQuestion(7, 1, { questionId: 0 })).rejects.toMatchObject({ status: 400 });
    expect(from).not.toHaveBeenCalled();
  });

  it('409s once the exam has attempts', async () => {
    queue.push(ownedExam(), rows([{ id: 4 }]));

    await expect(attachQuestion(7, 1, { questionId: 11 })).rejects.toMatchObject({ status: 409 });
  });

  it('404s a question the professor neither owns nor uses in an exam of theirs', async () => {
    queue.push(ownedExam(), noAttempts(), rows({ id: 11, created_by: 99 }), rows([]));

    await expect(attachQuestion(7, 1, { questionId: 11 })).rejects.toMatchObject({ status: 404, message: 'Question not found' });
  });

  it('takes a question that is already in an exam the professor manages', async () => {
    queue.push(
      ownedExam(),
      noAttempts(),
      rows({ id: 11, created_by: 99 }),
      rows([{ exam_id: 4 }]),
      rows([{ id: 4 }]),
      rows([]),
      rows([{ position: 2 }]),
      rows({ question_id: 11, position: 3, marks: 1 })
    );

    expect(await attachQuestion(7, 1, { questionId: 11 })).toEqual({ question_id: 11, position: 3, marks: 1 });
  });

  it('appends the question after the last position', async () => {
    queue.push(ownedExam(), noAttempts(), rows({ id: 11, created_by: 7 }), rows([{ position: 3 }]), rows({ question_id: 11, position: 4, marks: 5 }));

    await attachQuestion(7, 1, { questionId: 11, marks: 5 });

    expect(argsOf('exam_question', 'insert')[0][0]).toEqual({ exam_id: 1, question_id: 11, position: 4, marks: 5 });
  });

  it('starts at position 1 in an empty exam', async () => {
    queue.push(ownedExam(), noAttempts(), rows({ id: 11, created_by: 7 }), rows([]), rows({ question_id: 11, position: 1, marks: 1 }));

    await attachQuestion(7, 1, { questionId: 11 });

    expect(argsOf('exam_question', 'insert')[0][0]).toMatchObject({ position: 1, marks: 1 });
  });

  it('409s a question that is already in the exam', async () => {
    queue.push(ownedExam(), noAttempts(), rows({ id: 11, created_by: 7 }), rows([]), duplicate);

    await expect(attachQuestion(7, 1, { questionId: 11 })).rejects.toMatchObject({ status: 409 });
  });
});

describe('updateExamQuestion', () => {
  it('refuses marks that are not a whole number', async () => {
    await expect(updateExamQuestion(7, 1, 11, { marks: 2.5 })).rejects.toMatchObject({ status: 400 });
    expect(from).not.toHaveBeenCalled();
  });

  it('404s a question that is not in the exam', async () => {
    queue.push(ownedExam(), noAttempts(), rows([]));

    await expect(updateExamQuestion(7, 1, 11, { marks: 5 })).rejects.toMatchObject({ status: 404 });
  });

  it('changes the marks of the link only', async () => {
    queue.push(ownedExam(), noAttempts(), rows([{ question_id: 11, position: 1, marks: 5 }]));

    expect(await updateExamQuestion(7, 1, 11, { marks: 5 })).toEqual({ question_id: 11, position: 1, marks: 5 });
    expect(argsOf('exam_question', 'update')[0][0]).toEqual({ marks: 5 });
  });
});

describe('reorderQuestions', () => {
  it('refuses a list that is not made of ids', async () => {
    await expect(reorderQuestions(7, 1, { questionIds: [] })).rejects.toMatchObject({ status: 400 });
    await expect(reorderQuestions(7, 1, { questionIds: ['x'] })).rejects.toMatchObject({ status: 400 });
    await expect(reorderQuestions(7, 1, { questionIds: [11, 11] })).rejects.toMatchObject({ status: 400 });
    expect(from).not.toHaveBeenCalled();
  });

  it('wants every question of the exam exactly once', async () => {
    queue.push(ownedExam(), noAttempts(), rows([{ question_id: 11 }, { question_id: 12 }]));

    await expect(reorderQuestions(7, 1, { questionIds: [11] })).rejects.toMatchObject({ status: 400 });
  });

  it('renumbers the whole exam in one statement', async () => {
    queue.push(
      ownedExam(),
      noAttempts(),
      rows([{ question_id: 11 }, { question_id: 12 }]),
      rows(null),
      rows([{ question_id: 12, position: 1, marks: 5 }, { question_id: 11, position: 2, marks: 5 }]),
      rows([{ id: 11 }, { id: 12 }]),
      rows([])
    );

    const questions: any[] = await reorderQuestions(7, 1, { questionIds: [12, 11] });

    const [payload, options] = argsOf('exam_question', 'upsert')[0];
    expect(payload).toEqual([
      { exam_id: 1, question_id: 12, position: 1 },
      { exam_id: 1, question_id: 11, position: 2 },
    ]);
    expect(options).toEqual({ onConflict: 'exam_id,question_id' });
    expect(questions.map((question) => question.id)).toEqual([12, 11]);
  });

  it('409s once the exam has attempts', async () => {
    queue.push(ownedExam(), rows([{ id: 4 }]));

    await expect(reorderQuestions(7, 1, { questionIds: [11] })).rejects.toMatchObject({ status: 409 });
  });
});

describe('detachQuestion', () => {
  it('404s a question that is not in the exam', async () => {
    queue.push(ownedExam(), noAttempts(), rows([]));

    await expect(detachQuestion(7, 1, 11)).rejects.toMatchObject({ status: 404 });
  });

  it('removes the link only', async () => {
    queue.push(ownedExam(), noAttempts(), rows([{ question_id: 11 }]));

    await detachQuestion(7, 1, 11);

    expect(from).not.toHaveBeenCalledWith('questions');
    expect(argsOf('exam_question', 'delete')).toHaveLength(1);
  });
});

describe('events', () => {
  it('lists the catalog without the soft deleted rows', async () => {
    queue.push(rows([{ id: 1, name: 'tab_switch', description: 'switched tab' }]));

    expect(await listEventCatalog()).toHaveLength(1);
    expect(argsOf('events', 'is')).toEqual([['deleted_at', null]]);
  });

  it('404s an event that is not in the catalog', async () => {
    queue.push(ownedExam(), rows(null));

    await expect(attachEvent(7, 1, { eventId: 3 })).rejects.toMatchObject({ status: 404, message: 'Event not found' });
  });

  it('409s an event that is already monitored', async () => {
    queue.push(ownedExam(), rows({ id: 3, name: 'tab_switch' }), duplicate);

    await expect(attachEvent(7, 1, { eventId: 3 })).rejects.toMatchObject({ status: 409 });
  });

  it('monitors a catalog event', async () => {
    queue.push(ownedExam(), rows({ id: 3, name: 'tab_switch', description: 'switched tab' }), rows(null));

    expect(await attachEvent(7, 1, { eventId: 3 })).toMatchObject({ id: 3, name: 'tab_switch' });
    expect(argsOf('exam_events', 'insert')[0][0]).toEqual({ exam_id: 1, event_id: 3 });
  });

  it('404s an event that is not monitored when it is detached', async () => {
    queue.push(ownedExam(), rows([]));

    await expect(detachEvent(7, 1, 3)).rejects.toMatchObject({ status: 404 });
  });
});

describe('permitted urls', () => {
  it('only takes http and https addresses', async () => {
    await expect(addPermittedUrl(7, 1, { url: 'ftp://files.magi' })).rejects.toMatchObject({ status: 400 });
    await expect(addPermittedUrl(7, 1, { url: 'docs.magi' })).rejects.toMatchObject({ status: 400 });
    await expect(addPermittedUrl(7, 1, { url: '' })).rejects.toMatchObject({ status: 400 });
    await expect(addPermittedUrl(7, 1, { url: 'javascript:alert(1)' })).rejects.toMatchObject({ status: 400 });
    expect(from).not.toHaveBeenCalled();
  });

  it('reuses the stored address', async () => {
    queue.push(ownedExam(), rows([{ id: 4, url: 'https://docs.magi' }]), rows(null));

    expect(await addPermittedUrl(7, 1, { url: 'https://docs.magi' })).toEqual({ id: 4, url: 'https://docs.magi' });
    expect(argsOf('permitted_urls', 'insert')).toHaveLength(0);
    expect(argsOf('exam_permitted_url', 'insert')[0][0]).toEqual({ exam_id: 1, permitted_url_id: 4 });
  });

  it('stores an address nobody permitted yet', async () => {
    queue.push(ownedExam(), rows([]), rows({ id: 9, url: 'https://docs.magi' }), rows(null));

    expect(await addPermittedUrl(7, 1, { url: '  https://docs.magi  ' })).toEqual({ id: 9, url: 'https://docs.magi' });
    expect(argsOf('permitted_urls', 'insert')[0][0]).toEqual({ url: 'https://docs.magi' });
  });

  it('409s an address that is already permitted for this exam', async () => {
    queue.push(ownedExam(), rows([{ id: 4, url: 'https://docs.magi' }]), duplicate);

    await expect(addPermittedUrl(7, 1, { url: 'https://docs.magi' })).rejects.toMatchObject({ status: 409 });
  });

  it('404s an address that is not permitted for this exam', async () => {
    queue.push(ownedExam(), rows([]));

    await expect(removePermittedUrl(7, 1, 4)).rejects.toMatchObject({ status: 404 });
  });
});
