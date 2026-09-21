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
  for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'is', 'in', 'ilike', 'order', 'limit']) {
    builder[method] = vi.fn(() => builder);
  };
  const from = vi.fn(() => builder);
  return { from, builder, results };
});

vi.mock('../../lib/db.js', () => ({ database: { from } }));

import * as questionService from '../../services/question.service.js';

const ok = (data: unknown) => ({ data, error: null });
const fail = (error: unknown) => ({ data: null, error });
const queue = (...items: { data: unknown; error: unknown }[]) => results.push(...items);

const QUESTION = { id: 11, title: 'Binary search', question_type: 'multiple_choice', created_by: 3 };
const OPTIONS = [
  { id: 1, question_id: 11, option_text: 'O(log n)', is_correct: true },
  { id: 2, question_id: 11, option_text: 'O(n)', is_correct: false },
];
const choices = [{ optionText: 'O(log n)', isCorrect: true }, { optionText: 'O(n)' }];

beforeEach(() => {
  results.length = 0;
  vi.clearAllMocks();
});

describe('createQuestion', () => {
  it('needs a title', async () => {
    await expect(questionService.createQuestion(3, { options: choices })).rejects.toMatchObject({ status: 400 });
    await expect(questionService.createQuestion(3, { title: '  ' })).rejects.toMatchObject({ status: 400 });
    await expect(questionService.createQuestion(3, { title: 'a'.repeat(101) })).rejects.toMatchObject({ status: 400 });
    expect(from).not.toHaveBeenCalled();
  });

  it('checks questionType, expectedDuration and its unit against the enums', async () => {
    await expect(questionService.createQuestion(3, { title: 'Q', questionType: 'oral' })).rejects.toMatchObject({ status: 400 });
    await expect(questionService.createQuestion(3, { title: 'Q', questionType: 'essay', expectedDuration: -1 })).rejects.toMatchObject({ status: 400 });
    await expect(questionService.createQuestion(3, { title: 'Q', questionType: 'essay', expectedDuration: 1.5 })).rejects.toMatchObject({ status: 400 });
    await expect(questionService.createQuestion(3, { title: 'Q', questionType: 'essay', expectedDurationUnit: 'weeks' })).rejects.toMatchObject({ status: 400 });
  });

  it('wants at least 2 options and 1 correct one for multiple_choice', async () => {
    await expect(questionService.createQuestion(3, { title: 'Q', options: [{ optionText: 'only' }] })).rejects.toMatchObject({ status: 400 });
    await expect(questionService.createQuestion(3, { title: 'Q' })).rejects.toMatchObject({ status: 400 });
    await expect(
      questionService.createQuestion(3, { title: 'Q', options: [{ optionText: 'a' }, { optionText: 'b' }] })
    ).rejects.toMatchObject({ status: 400, message: 'A multiple_choice question needs at least 1 correct option' });
  });

  it('wants exactly 2 options and exactly 1 correct one for true_false', async () => {
    const body = { title: 'Q', questionType: 'true_false' };

    await expect(questionService.createQuestion(3, { ...body, options: [{ optionText: 'true', isCorrect: true }] })).rejects.toMatchObject({ status: 400 });
    await expect(
      questionService.createQuestion(3, { ...body, options: [{ optionText: 'true', isCorrect: true }, { optionText: 'false', isCorrect: true }] })
    ).rejects.toMatchObject({ status: 400, message: 'A true_false question needs exactly 1 correct option' });
  });

  it('takes no options for short_answer and essay', async () => {
    await expect(questionService.createQuestion(3, { title: 'Q', questionType: 'essay', options: choices })).rejects.toMatchObject({
      status: 400,
      message: 'essay questions take no options',
    });
    await expect(questionService.createQuestion(3, { title: 'Q', questionType: 'short_answer', options: choices })).rejects.toMatchObject({ status: 400 });
  });

  it('rejects options that are not a list of texts', async () => {
    await expect(questionService.createQuestion(3, { title: 'Q', options: 'a,b' })).rejects.toMatchObject({ status: 400 });
    await expect(questionService.createQuestion(3, { title: 'Q', options: ['a', 'b'] })).rejects.toMatchObject({ status: 400 });
    await expect(questionService.createQuestion(3, { title: 'Q', options: [{ optionText: 'a', isCorrect: 'yes' }, { optionText: 'b' }] })).rejects.toMatchObject({ status: 400 });
  });

  it('writes the question with its owner and its options', async () => {
    queue(ok(QUESTION), ok(OPTIONS));

    const created = await questionService.createQuestion(3, { title: '  Binary search  ', options: choices });

    expect(created).toEqual({ ...QUESTION, options: OPTIONS });
    expect(from).toHaveBeenNthCalledWith(1, 'questions');
    expect(builder.insert).toHaveBeenNthCalledWith(1, { title: 'Binary search', question_type: 'multiple_choice', created_by: 3 });
    expect(from).toHaveBeenNthCalledWith(2, 'question_options');
    expect(builder.insert).toHaveBeenNthCalledWith(2, [
      { option_text: 'O(log n)', is_correct: true, question_id: 11 },
      { option_text: 'O(n)', is_correct: false, question_id: 11 },
    ]);
  });

  it('writes no options for an essay question', async () => {
    queue(ok({ ...QUESTION, question_type: 'essay' }));

    const created = await questionService.createQuestion(3, { title: 'Essay', questionType: 'essay', expectedDuration: 30, expectedDurationUnit: 'minutes' });

    expect(created.options).toEqual([]);
    expect(from).toHaveBeenCalledTimes(1);
    expect(builder.insert).toHaveBeenCalledWith({
      title: 'Essay',
      question_type: 'essay',
      expected_duration: 30,
      expected_duration_unit: 'minutes',
      created_by: 3,
    });
  });

  it('removes the question again when its options cannot be written', async () => {
    queue(ok(QUESTION), fail({ message: 'options failed' }), ok(null));

    await expect(questionService.createQuestion(3, { title: 'Q', options: choices })).rejects.toThrow('options failed');
    expect(from).toHaveBeenNthCalledWith(3, 'questions');
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith('id', 11);
  });
});

describe('listQuestions', () => {
  it('lists the live questions of the professor', async () => {
    queue(ok([QUESTION]));

    expect(await questionService.listQuestions(3, {})).toEqual([QUESTION]);
    expect(from).toHaveBeenCalledWith('questions');
    expect(builder.eq).toHaveBeenCalledWith('created_by', 3);
    expect(builder.is).toHaveBeenCalledWith('deleted_at', null);
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('filters by type and searches the title', async () => {
    queue(ok([]));

    await questionService.listQuestions(3, { questionType: 'essay', search: ' search ' });

    expect(builder.eq).toHaveBeenCalledWith('question_type', 'essay');
    expect(builder.ilike).toHaveBeenCalledWith('title', '%search%');
  });

  it('rejects an unknown type or an empty search', async () => {
    await expect(questionService.listQuestions(3, { questionType: 'oral' })).rejects.toMatchObject({ status: 400 });
    await expect(questionService.listQuestions(3, { search: '  ' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('getQuestion', () => {
  it('answers 404 for an id that is not an id', async () => {
    await expect(questionService.getQuestion(3, 'abc')).rejects.toMatchObject({ status: 404 });
    expect(from).not.toHaveBeenCalled();
  });

  it('gives the owner the question with its options', async () => {
    queue(ok(QUESTION), ok(OPTIONS));

    expect(await questionService.getQuestion(3, '11')).toEqual({ ...QUESTION, options: OPTIONS });
    expect(builder.eq).toHaveBeenCalledWith('created_by', 3);
  });

  it('lets a professor read a question their own exam asks', async () => {
    queue(ok(null), ok([{ exam_id: 2 }]), ok([{ id: 2 }]), ok(QUESTION), ok(OPTIONS));

    expect(await questionService.getQuestion(9, '11')).toEqual({ ...QUESTION, options: OPTIONS });
    expect(from).toHaveBeenNthCalledWith(2, 'exam_question');
    expect(from).toHaveBeenNthCalledWith(3, 'exams');
  });

  it('lets a professor read a question asked by an exam of a module they teach', async () => {
    queue(ok(null), ok([{ exam_id: 2 }]), ok([]), ok([{ module_id: 4 }]), ok([{ exam_id: 2 }]), ok(QUESTION), ok(OPTIONS));

    expect(await questionService.getQuestion(9, '11')).toEqual({ ...QUESTION, options: OPTIONS });
    expect(from).toHaveBeenNthCalledWith(5, 'exam_module');
  });

  it('answers 404 when the question belongs to no exam of the professor', async () => {
    queue(ok(null), ok([{ exam_id: 2 }]), ok([]), ok([]));

    await expect(questionService.getQuestion(9, '11')).rejects.toMatchObject({ status: 404 });
  });

  it('answers 404 for a question of somebody else that no exam asks', async () => {
    queue(ok(null), ok([]));

    await expect(questionService.getQuestion(9, '11')).rejects.toMatchObject({ status: 404 });
  });
});

describe('updateQuestion', () => {
  it('answers 404 for a question of somebody else', async () => {
    queue(ok(null));

    await expect(questionService.updateQuestion(9, '11', { title: 'Mine now' })).rejects.toMatchObject({ status: 404 });
  });

  it('rejects an empty update', async () => {
    queue(ok(QUESTION));

    await expect(questionService.updateQuestion(3, '11', {})).rejects.toMatchObject({ status: 400 });
  });

  it('updates the fields and keeps the options', async () => {
    queue(ok(QUESTION), ok(OPTIONS), ok({ ...QUESTION, title: 'Binary search II' }));

    const updated = await questionService.updateQuestion(3, '11', { title: 'Binary search II' });

    expect(updated).toEqual({ ...QUESTION, title: 'Binary search II', options: OPTIONS });
    expect(builder.update).toHaveBeenCalledWith({ title: 'Binary search II' });
  });

  it('refuses a new type the kept options do not fit', async () => {
    queue(ok(QUESTION), ok([...OPTIONS, { id: 3, question_id: 11, option_text: 'O(1)', is_correct: false }]));

    await expect(questionService.updateQuestion(3, '11', { questionType: 'true_false' })).rejects.toMatchObject({ status: 400 });
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('accepts a new type the kept options fit', async () => {
    queue(ok(QUESTION), ok(OPTIONS), ok({ ...QUESTION, question_type: 'true_false' }));

    const updated = await questionService.updateQuestion(3, '11', { questionType: 'true_false' });
    expect(updated.question_type).toBe('true_false');
  });

  it('replaces the option set by soft deleting the old rows', async () => {
    queue(ok(QUESTION), ok([]), ok(QUESTION), ok([{ id: 1 }, { id: 2 }]), ok([{ id: 3 }, { id: 4 }]));

    const updated = await questionService.updateQuestion(3, '11', { options: choices });

    expect(updated.options).toEqual([{ id: 3 }, { id: 4 }]);
    const patch = builder.update.mock.calls[0][0];
    expect(patch.reason).toBe('options replaced');
    expect(Number.isNaN(Date.parse(patch.deleted_at))).toBe(false);
  });

  it('refuses to change the options of an answered question', async () => {
    queue(ok(QUESTION), ok([{ assignment_id: 1 }]));

    await expect(questionService.updateQuestion(3, '11', { options: choices })).rejects.toMatchObject({ status: 409 });
    expect(builder.update).not.toHaveBeenCalled();
    expect(from).toHaveBeenLastCalledWith('question_assignment');
  });

  it('puts the old options back when the new ones cannot be written', async () => {
    queue(ok(QUESTION), ok([]), ok(QUESTION), ok([{ id: 1 }, { id: 2 }]), fail({ message: 'insert failed' }), ok(null));

    await expect(questionService.updateQuestion(3, '11', { options: choices })).rejects.toThrow('insert failed');
    expect(builder.update).toHaveBeenLastCalledWith({ deleted_at: null, reason: null });
    expect(builder.in).toHaveBeenCalledWith('id', [1, 2]);
  });
});

describe('deleteQuestion', () => {
  it('answers 404 for a question of somebody else', async () => {
    queue(ok(null));

    await expect(questionService.deleteQuestion(9, '11', {})).rejects.toMatchObject({ status: 404 });
  });

  it('refuses to delete an answered question', async () => {
    queue(ok(QUESTION), ok([{ assignment_id: 1 }]));

    await expect(questionService.deleteQuestion(3, '11', {})).rejects.toMatchObject({ status: 409 });
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('stamps deleted_at and keeps the reason', async () => {
    queue(ok(QUESTION), ok([]), ok(null));

    await questionService.deleteQuestion(3, '11', { reason: 'replaced by a clearer wording' });

    const patch = builder.update.mock.calls[0][0];
    expect(patch.reason).toBe('replaced by a clearer wording');
    expect(Number.isNaN(Date.parse(patch.deleted_at))).toBe(false);
  });

  it('rejects a reason that is not a string', async () => {
    queue(ok(QUESTION));

    await expect(questionService.deleteQuestion(3, '11', { reason: 42 })).rejects.toMatchObject({ status: 400 });
  });
});
