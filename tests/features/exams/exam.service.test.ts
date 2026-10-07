import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type Role, type TokenPayload } from '../../../lib/types.js';

// one chainable fake for every supabase call: each awaited query takes the next queued result
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
  listExams,
  getExam,
  createExam,
  updateExam,
  deleteExam,
  setExamStatus,
  linkModule,
  addExaminer,
  addStudents,
  removeStudent,
} from '../../../features/exams/exam.service.js';

const rows = (data: unknown) => ({ data, error: null });
const duplicate = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };

const asUser = (id: number, role: Role): TokenPayload =>
  ({ id, first_name: 'Test', last_name: null, email: 'test@magi', role, iat: 0, exp: 0 });

const argsOf = (table: string, method: string) => calls.filter((call) => call.table === table && call.method === method).map((call) => call.args);

beforeEach(() => {
  queue.length = 0;
  calls.length = 0;
  from.mockClear();
});

describe('listExams', () => {
  it('gives a professor the exams they created and the exams of the modules they teach', async () => {
    // the created ones, the modules taught, the exams linked to them, the live ones among those, the answer
    queue.push(rows([{ id: 1 }]), rows([{ module_id: 5 }]), rows([{ exam_id: 2 }]), rows([{ id: 2 }]), rows([{ id: 1 }, { id: 2 }]));

    const exams = await listExams(asUser(7, 'professor'));

    expect(from).toHaveBeenCalledWith('module_professor');
    expect(from).toHaveBeenCalledWith('exam_module');
    expect(argsOf('exams', 'in')).toEqual([['id', [2]], ['id', [1, 2]]]);
    expect(exams).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('leaves out an exam of a module the professor teaches that is soft deleted', async () => {
    queue.push(rows([]), rows([{ module_id: 5 }]), rows([{ exam_id: 2 }]), rows([]));

    expect(await listExams(asUser(7, 'professor'))).toEqual([]);
  });

  it('gives an examiner only the exams they are assigned to', async () => {
    queue.push(rows([{ exam_id: 3 }]), rows([{ id: 3 }]));

    const exams = await listExams(asUser(8, 'examiner'));

    expect(argsOf('exam_examiner', 'eq')).toEqual([['examiner_id', 8]]);
    expect(exams).toEqual([{ id: 3 }]);
  });

  it('hides the owner and the shuffling from a student', async () => {
    queue.push(rows([{ exam_id: 3 }]), rows([{ id: 3 }]));

    await listExams(asUser(9, 'student'));

    const [[columns]] = argsOf('exams', 'select');
    expect(columns).not.toContain('created_by');
    expect(columns).not.toContain('shuffle_questions');
  });

  it('does not query the exams when nothing is assigned', async () => {
    queue.push(rows([]));

    expect(await listExams(asUser(9, 'student'))).toEqual([]);
    expect(from).toHaveBeenCalledOnce();
  });
});

describe('getExam', () => {
  it('gives a student the schedule and the permitted urls but no questions', async () => {
    queue.push(
      rows({ id: 3, name: 'Databases', status: 'scheduled' }),
      rows({ exam_id: 3 }),
      rows([{ permitted_url_id: 4 }]),
      rows([{ id: 4, url: 'https://docs.magi' }])
    );

    const exam = await getExam(asUser(9, 'student'), 3);

    expect(exam).toEqual({ id: 3, name: 'Databases', status: 'scheduled', permitted_urls: [{ id: 4, url: 'https://docs.magi' }] });
    expect(from).not.toHaveBeenCalledWith('exam_question');
    expect(from).not.toHaveBeenCalledWith('questions');
  });

  it('404s an exam a student is not assigned to', async () => {
    queue.push(rows({ id: 3, name: 'Databases' }), rows(null));

    await expect(getExam(asUser(9, 'student'), 3)).rejects.toMatchObject({ status: 404, message: 'Exam not found' });
  });

  it('404s an exam that is soft deleted without asking who the caller is', async () => {
    queue.push(rows(null));

    await expect(getExam(asUser(9, 'student'), 3)).rejects.toMatchObject({ status: 404 });
    expect(from).toHaveBeenCalledOnce();
  });

  it('gives a professor the questions with is_correct and the marks total', async () => {
    queue.push(
      rows({ id: 1, created_by: 7, max_marks: 10 }),
      rows([{ question_id: 11, position: 1, marks: 6 }]),
      rows([{ id: 11, title: 'Normal forms' }]),
      rows([{ id: 21, question_id: 11, option_text: '3NF', is_correct: true }]),
      rows([]),
      rows([]),
      rows([]),
      rows([]),
      rows([])
    );

    const exam: any = await getExam(asUser(7, 'professor'), 1);

    expect(exam.questions[0].options[0].is_correct).toBe(true);
    expect(exam.questions[0].marks).toBe(6);
    expect(exam.marks_total).toBe(6);
  });

  it('lets a professor of a linked module in', async () => {
    queue.push(
      rows({ id: 1, created_by: 99 }),
      rows([{ module_id: 5 }]),
      rows([{ module_id: 5 }]),
      rows([]), rows([]), rows([]), rows([]), rows([]), rows([])
    );

    const exam: any = await getExam(asUser(7, 'professor'), 1);

    expect(exam.id).toBe(1);
  });

  it('404s an exam of a professor who neither owns it nor teaches its modules', async () => {
    queue.push(rows({ id: 1, created_by: 99 }), rows([{ module_id: 5 }]), rows([]));

    await expect(getExam(asUser(7, 'professor'), 1)).rejects.toMatchObject({ status: 404 });
  });

  it('drops a question its owner soft deleted', async () => {
    queue.push(
      rows({ id: 1, created_by: 7 }),
      rows([{ question_id: 11, position: 1, marks: 6 }, { question_id: 12, position: 2, marks: 4 }]),
      rows([{ id: 12, title: 'Still there' }]),
      rows([]),
      rows([]), rows([]), rows([]), rows([]), rows([])
    );

    const exam: any = await getExam(asUser(7, 'professor'), 1);

    expect(exam.questions).toHaveLength(1);
    expect(exam.marks_total).toBe(4);
  });
});

describe('createExam', () => {
  const body = { name: 'Databases', scheduledStart: '2027-01-10T09:00:00Z', scheduledEnd: '2027-01-10T11:00:00Z' };

  it('refuses an empty name, a bad date and an end before the start', async () => {
    await expect(createExam(7, { ...body, name: '  ' })).rejects.toMatchObject({ status: 400 });
    await expect(createExam(7, { ...body, scheduledStart: 'tomorrow' })).rejects.toMatchObject({ status: 400 });
    await expect(createExam(7, { ...body, scheduledEnd: body.scheduledStart })).rejects.toMatchObject({ status: 400 });
    expect(from).not.toHaveBeenCalled();
  });

  it('refuses passing marks above the maximum and a status that is not scheduled or demo', async () => {
    await expect(createExam(7, { ...body, maxMarks: 20, passingMarks: 21 })).rejects.toMatchObject({ status: 400 });
    await expect(createExam(7, { ...body, maxMarks: -1 })).rejects.toMatchObject({ status: 400 });
    await expect(createExam(7, { ...body, status: 'completed' })).rejects.toMatchObject({ status: 400 });
    expect(from).not.toHaveBeenCalled();
  });

  it('stores the professor as the owner', async () => {
    queue.push(rows({ id: 1 }));

    await createExam(7, body);

    expect(argsOf('exams', 'insert')[0][0]).toMatchObject({
      name: 'Databases',
      status: 'scheduled',
      max_marks: 100,
      passing_marks: 0,
      shuffle_questions: true,
      created_by: 7,
    });
  });
});

describe('updateExam', () => {
  it('refuses to move the schedule once the exam has attempts', async () => {
    queue.push(rows({ id: 1, created_by: 7, scheduled_start: '2026-01-10T09:00:00Z', scheduled_end: '2026-01-10T11:00:00Z', max_marks: 100, passing_marks: 0 }), rows([{ id: 4 }]));

    await expect(updateExam(7, 1, { scheduledEnd: '2026-01-10T12:00:00Z' })).rejects.toMatchObject({ status: 409 });
  });

  it('still renames an exam that has attempts', async () => {
    queue.push(rows({ id: 1, created_by: 7, scheduled_start: '2026-01-10T09:00:00Z', scheduled_end: '2026-01-10T11:00:00Z', max_marks: 100, passing_marks: 0 }), rows({ id: 1, name: 'Resit' }));

    await updateExam(7, 1, { name: 'Resit' });

    expect(from).not.toHaveBeenCalledWith('assignments');
  });

  it('checks the new value against the stored one', async () => {
    queue.push(rows({ id: 1, created_by: 7, scheduled_start: '2026-01-10T09:00:00Z', scheduled_end: '2026-01-10T11:00:00Z', max_marks: 50, passing_marks: 10 }));

    await expect(updateExam(7, 1, { passingMarks: 60 })).rejects.toMatchObject({ status: 400 });
  });

  it('refuses an empty patch', async () => {
    queue.push(rows({ id: 1, created_by: 7 }));

    await expect(updateExam(7, 1, {})).rejects.toMatchObject({ status: 400, message: 'Nothing to update' });
  });
});

describe('deleteExam', () => {
  it('needs a reason', async () => {
    await expect(deleteExam(7, 1, { reason: '  ' })).rejects.toMatchObject({ status: 400 });
    expect(from).not.toHaveBeenCalled();
  });

  it('soft deletes with the reason', async () => {
    queue.push(rows({ id: 1, created_by: 7 }), rows(null));

    await deleteExam(7, 1, { reason: 'replaced by the resit' });

    const [patch] = argsOf('exams', 'update')[0];
    expect(patch).toMatchObject({ reason: 'replaced by the resit' });
    expect(patch.deleted_at).toBeTruthy();
  });
});

describe('setExamStatus', () => {
  it('refuses a status outside the enum', async () => {
    await expect(setExamStatus(7, 1, { status: 'paused' })).rejects.toMatchObject({ status: 400 });
    expect(from).not.toHaveBeenCalled();
  });

  it('refuses to leave a completed exam', async () => {
    queue.push(rows({ id: 1, created_by: 7, status: 'completed' }));

    await expect(setExamStatus(7, 1, { status: 'ongoing' })).rejects.toMatchObject({ status: 409 });
  });

  it('refuses to leave a cancelled exam', async () => {
    queue.push(rows({ id: 1, created_by: 7, status: 'cancelled' }));

    await expect(setExamStatus(7, 1, { status: 'scheduled' })).rejects.toMatchObject({ status: 409 });
  });

  it('refuses to start an exam whose questions do not add up to max_marks', async () => {
    queue.push(
      rows({ id: 1, created_by: 7, status: 'scheduled', max_marks: 100 }),
      rows([{ question_id: 11, position: 1, marks: 6 }]),
      rows([{ id: 11 }]),
      rows([])
    );

    await expect(setExamStatus(7, 1, { status: 'ongoing' })).rejects.toMatchObject({ status: 409, message: 'The questions add up to 6 marks, the exam is out of 100' });
  });

  it('refuses to start an exam without questions', async () => {
    queue.push(rows({ id: 1, created_by: 7, status: 'scheduled', max_marks: 100 }), rows([]));

    await expect(setExamStatus(7, 1, { status: 'ongoing' })).rejects.toMatchObject({ status: 409, message: 'The exam has no questions yet' });
  });

  it('starts an exam whose marks match', async () => {
    queue.push(
      rows({ id: 1, created_by: 7, status: 'scheduled', max_marks: 10 }),
      rows([{ question_id: 11, position: 1, marks: 10 }]),
      rows([{ id: 11 }]),
      rows([]),
      rows({ id: 1, status: 'ongoing' })
    );

    expect(await setExamStatus(7, 1, { status: 'ongoing' })).toEqual({ id: 1, status: 'ongoing' });
  });

  it('delays a scheduled exam without counting marks', async () => {
    queue.push(rows({ id: 1, created_by: 7, status: 'scheduled', max_marks: 10 }), rows({ id: 1, status: 'delayed' }));

    await setExamStatus(7, 1, { status: 'delayed' });

    expect(from).not.toHaveBeenCalledWith('exam_question');
  });
});

describe('linkModule', () => {
  it('404s a module the professor does not teach', async () => {
    queue.push(rows({ id: 1, created_by: 7 }), rows([]), rows(null));

    await expect(linkModule(7, 1, { moduleId: 5 })).rejects.toMatchObject({ status: 404, message: 'Module not found' });
  });

  it('409s a module that is already linked', async () => {
    queue.push(rows({ id: 1, created_by: 7 }), rows([]), rows({ module_id: 5 }), duplicate);

    await expect(linkModule(7, 1, { moduleId: 5 })).rejects.toMatchObject({ status: 409 });
  });

  it('409s once the exam has attempts', async () => {
    queue.push(rows({ id: 1, created_by: 7 }), rows([{ id: 4 }]));

    await expect(linkModule(7, 1, { moduleId: 5 })).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a moduleId that is not an id', async () => {
    await expect(linkModule(7, 1, { moduleId: 'five' })).rejects.toMatchObject({ status: 400 });
    expect(from).not.toHaveBeenCalled();
  });
});

describe('addExaminer', () => {
  it('404s a user that does not have the examiner role', async () => {
    queue.push(rows({ id: 1, created_by: 7 }), rows(null));

    await expect(addExaminer(7, 1, { examinerId: 8 })).rejects.toMatchObject({ status: 404, message: 'Examiner not found' });
  });

  it('409s an examiner that is already assigned', async () => {
    queue.push(rows({ id: 1, created_by: 7 }), rows({ user_id: 8 }), duplicate);

    await expect(addExaminer(7, 1, { examinerId: 8 })).rejects.toMatchObject({ status: 409 });
  });

  it('assigns an examiner even when the exam has attempts', async () => {
    queue.push(rows({ id: 1, created_by: 7 }), rows({ user_id: 8 }), rows(null));

    expect(await addExaminer(7, 1, { examinerId: 8 })).toEqual({ exam_id: 1, examiner_id: 8 });
    expect(from).not.toHaveBeenCalledWith('assignments');
  });
});

describe('addStudents', () => {
  it('wants exactly one of studentId and moduleId', async () => {
    await expect(addStudents(7, 1, {})).rejects.toMatchObject({ status: 400 });
    await expect(addStudents(7, 1, { studentId: 9, moduleId: 5 })).rejects.toMatchObject({ status: 400 });
    expect(from).not.toHaveBeenCalled();
  });

  it('404s a student that is enrolled in none of the modules of the exam', async () => {
    queue.push(rows({ id: 1, created_by: 7 }), rows([]), rows([{ module_id: 5 }]), rows([]));

    await expect(addStudents(7, 1, { studentId: 9 })).rejects.toMatchObject({ status: 404, message: 'Student not found' });
  });

  it('409s a student that is already assigned', async () => {
    queue.push(rows({ id: 1, created_by: 7 }), rows([]), rows([{ module_id: 5 }]), rows([{ student_id: 9 }]), duplicate);

    await expect(addStudents(7, 1, { studentId: 9 })).rejects.toMatchObject({ status: 409 });
  });

  it('assigns one enrolled student', async () => {
    queue.push(rows({ id: 1, created_by: 7 }), rows([]), rows([{ module_id: 5 }]), rows([{ student_id: 9 }]), rows(null));

    expect(await addStudents(7, 1, { studentId: 9 })).toEqual({ added: [9] });
  });

  it('404s a module that is not linked to the exam', async () => {
    queue.push(rows({ id: 1, created_by: 7 }), rows([]), rows([{ module_id: 5 }]));

    await expect(addStudents(7, 1, { moduleId: 6 })).rejects.toMatchObject({ status: 404, message: 'Module not found' });
  });

  it('adds every student of a linked module and skips the ones already assigned', async () => {
    queue.push(
      rows({ id: 1, created_by: 7 }),
      rows([]),
      rows([{ module_id: 5 }]),
      rows([{ student_id: 9 }, { student_id: 10 }]),
      rows([{ student_id: 9 }]),
      rows(null)
    );

    expect(await addStudents(7, 1, { moduleId: 5 })).toEqual({ added: [10] });
    expect(argsOf('exam_student', 'insert')[0][0]).toEqual([{ exam_id: 1, student_id: 10 }]);
  });

  it('409s once the exam has attempts', async () => {
    queue.push(rows({ id: 1, created_by: 7 }), rows([{ id: 4 }]));

    await expect(addStudents(7, 1, { studentId: 9 })).rejects.toMatchObject({ status: 409 });
  });
});

describe('removeStudent', () => {
  it('404s a student that is not assigned', async () => {
    queue.push(rows({ id: 1, created_by: 7 }), rows([]), rows([]));

    await expect(removeStudent(7, 1, 9)).rejects.toMatchObject({ status: 404, message: 'Student not found' });
  });

  it('removes an assigned student', async () => {
    queue.push(rows({ id: 1, created_by: 7 }), rows([]), rows([{ student_id: 9 }]));

    await removeStudent(7, 1, 9);

    expect(argsOf('exam_student', 'eq')).toEqual([['exam_id', 1], ['student_id', 9]]);
  });
});
