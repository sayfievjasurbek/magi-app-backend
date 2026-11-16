import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as XLSX from 'xlsx';
import OpenAI from 'openai';

vi.mock('../../../lib/ai.js', () => ({ getClient: vi.fn() }));
vi.mock('../../../features/modules/module.service.js', () => ({
  listModules: vi.fn(), getRoster: vi.fn(), createModule: vi.fn(), addProfessor: vi.fn(), deleteModule: vi.fn(), addStudent: vi.fn(),
  removeStudent: vi.fn(), removeProfessor: vi.fn(), updateModule: vi.fn(),
}));
vi.mock('../../../features/exams/exam.service.js', () => ({
  listExams: vi.fn(), getExam: vi.fn(), createExam: vi.fn(), updateExam: vi.fn(), setExamStatus: vi.fn(),
  linkModule: vi.fn(), addStudents: vi.fn(), attachQuestion: vi.fn(), detachQuestion: vi.fn(),
}));
vi.mock('../../../features/questions/question.service.js', () => ({ listQuestions: vi.fn(), createQuestion: vi.fn(), updateQuestion: vi.fn() }));
vi.mock('../../../features/attendance/attendance.service.js', () => ({ getAttendance: vi.fn(), setAttendance: vi.fn() }));
vi.mock('../../../features/cheatings/cheating.service.js', () => ({ examSummary: vi.fn() }));
vi.mock('../../../features/auth/auth.controller.js', () => ({ listManagedProfessors: vi.fn(), listManagedStudents: vi.fn(), updateStudentProfile: vi.fn() }));
vi.mock('../../../features/attempts/attempt.service.js', () => ({
  listExamAttempts: vi.fn(), listAttemptsSummary: vi.fn(), getAttempt: vi.fn(), gradeAttempt: vi.fn(), aiReviewAttempt: vi.fn(), allowRetake: vi.fn(),
}));
vi.mock('../../../lib/storage.js', () => ({ uploadChatImage: vi.fn().mockResolvedValue('https://cdn.example.com/ai-chat/9/photo.png') }));

import { runAssistant } from '../../../features/ai/assistant.service.js';
import { getClient } from '../../../lib/ai.js';
import {
  listModules, createModule, addProfessor, deleteModule, addStudent, removeStudent, removeProfessor, updateModule,
} from '../../../features/modules/module.service.js';
import { getExam, linkModule, addStudents, updateExam, setExamStatus, detachQuestion } from '../../../features/exams/exam.service.js';
import { updateQuestion } from '../../../features/questions/question.service.js';
import { listManagedProfessors, listManagedStudents, updateStudentProfile } from '../../../features/auth/auth.controller.js';
import { listExamAttempts, listAttemptsSummary, getAttempt, gradeAttempt, aiReviewAttempt, allowRetake } from '../../../features/attempts/attempt.service.js';
import { uploadChatImage } from '../../../lib/storage.js';
import { HttpError } from '../../../lib/errors.js';
import { type TokenPayload } from '../../../lib/types.js';

const USER: TokenPayload = { id: 9, role: 'professor', first_name: 'Ada', last_name: null, email: 'ada@magi.edu', iat: 0, exp: 0 };

// one scripted chat.completions.create per test, driven by a queue of { choices } responses
const create = vi.fn();
const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({
  id,
  type: 'function' as const,
  function: { name, arguments: JSON.stringify(args) },
});
const toolCallRound = (...calls: ReturnType<typeof toolCall>[]) => ({ choices: [{ message: { role: 'assistant', content: null, tool_calls: calls } }] });
const finalRound = (content: string) => ({ choices: [{ message: { role: 'assistant', content, tool_calls: [] } }] });

beforeEach(() => {
  create.mockReset();
  (getClient as any).mockReset().mockReturnValue({ chat: { completions: { create } } });
});

afterEach(() => vi.unstubAllGlobals());

describe('runAssistant', () => {
  it('400s when message is missing or blank, without calling OpenAI at all', async () => {
    await expect(runAssistant(USER, {})).rejects.toBeInstanceOf(HttpError);
    await expect(runAssistant(USER, { message: '   ' })).rejects.toBeInstanceOf(HttpError);
    expect(create).not.toHaveBeenCalled();
  });

  it('400s on a malformed history entry', async () => {
    const error = await runAssistant(USER, { message: 'hi', history: [{ role: 'system', content: 'nope' }] }).catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(400);
  });

  it('throws when AI is not configured', async () => {
    (getClient as any).mockReturnValue(null);
    await expect(runAssistant(USER, { message: 'hi' })).rejects.toThrow('AI is not configured');
  });

  describe('when OpenAI itself fails', () => {
    it('reports a clear, actionable message for an invalid/expired API key', async () => {
      create.mockRejectedValueOnce(new OpenAI.AuthenticationError(401, { message: 'Your API key has been invalidated.' }, 'Your API key has been invalidated.', new Headers()));

      const error = await runAssistant(USER, { message: 'hi' }).catch((e) => e);

      expect(error).toBeInstanceOf(HttpError);
      expect(error.status).toBe(503);
      expect(error.message).toContain('OpenAI rejected the API key');
    });

    it('tells the professor to add OpenAI credits when the account balance is exhausted', async () => {
      create.mockRejectedValueOnce(new OpenAI.RateLimitError(429, { code: 'credit_balance_exhausted', type: 'insufficient_quota', message: 'You have no credits remaining.' }, 'You have no credits remaining.', new Headers()));

      const error = await runAssistant(USER, { message: 'hi' }).catch((e) => e);

      expect(error).toBeInstanceOf(HttpError);
      expect(error.status).toBe(503);
      expect(error.message).toContain('no OpenAI credits left');
    });

    it('reports plain rate limiting separately from an exhausted balance', async () => {
      create.mockRejectedValueOnce(new OpenAI.RateLimitError(429, { message: 'Rate limit reached.' }, 'Rate limit reached.', new Headers()));

      const error = await runAssistant(USER, { message: 'hi' }).catch((e) => e);

      expect(error).toBeInstanceOf(HttpError);
      expect(error.status).toBe(503);
      expect(error.message).toContain('too many requests');
    });

    it('reports a timeout plainly', async () => {
      create.mockRejectedValueOnce(new OpenAI.APIConnectionTimeoutError());

      const error = await runAssistant(USER, { message: 'hi' }).catch((e) => e);

      expect(error).toBeInstanceOf(HttpError);
      expect(error.status).toBe(503);
      expect(error.message).toContain('taking too long');
    });

    it('still turns a completely unrelated error into the generic fallback', async () => {
      create.mockRejectedValueOnce(new Error('boom'));

      const error = await runAssistant(USER, { message: 'hi' }).catch((e) => e);

      expect(error).not.toBeInstanceOf(HttpError);
      expect(error.message).toBe('boom');
    });
  });

  it('strips <suggest> tags out of the reply and returns them as quick-reply options', async () => {
    create.mockResolvedValueOnce(finalRound(
      "Testning nomi va vaqti kerak.<suggest>Matematika, ertaga 10:00-12:00 bilan davom et</suggest><suggest>Boshqa nom va vaqt kiritaman</suggest>"
    ));

    const { reply, suggestions } = await runAssistant(USER, { message: 'test yarat' });

    expect(reply).toBe('Testning nomi va vaqti kerak.');
    expect(suggestions).toEqual(['Matematika, ertaga 10:00-12:00 bilan davom et', 'Boshqa nom va vaqt kiritaman']);
  });

  it('cleans up an orphaned bullet left behind when a <suggest> tag was placed as a whole list item', async () => {
    create.mockResolvedValueOnce(finalRound(
      "Qaysi birini o'chirmoqchisiz? Iltimos, tasdiqlang.\n-<suggest>Aisinf</suggest>\n-<suggest>class3</suggest>"
    ));

    const { reply, suggestions } = await runAssistant(USER, { message: "studentlari yo'q sinflarni ko'rsat" });

    expect(reply).toBe("Qaysi birini o'chirmoqchisiz? Iltimos, tasdiqlang.");
    expect(suggestions).toEqual(['Aisinf', 'class3']);
  });

  it('returns an empty suggestions array when the reply has no <suggest> tags', async () => {
    create.mockResolvedValueOnce(finalRound('Jami 18 ta talaba bor.'));

    const { reply, suggestions } = await runAssistant(USER, { message: 'nechta talaba bor?' });

    expect(reply).toBe('Jami 18 ta talaba bor.');
    expect(suggestions).toEqual([]);
  });

  it('runs the schedule_exam_to_group tool and reports the trace', async () => {
    create
      .mockResolvedValueOnce(toolCallRound(toolCall('call_1', 'schedule_exam_to_group', { examId: 12, groupId: 5 })))
      .mockResolvedValueOnce(finalRound('Scheduled it.'));
    (linkModule as any).mockResolvedValue({ exam_id: 12, module_id: 5 });
    (addStudents as any).mockResolvedValue({ added: [1, 2, 3] });

    const { reply, actions } = await runAssistant(USER, { message: "Midterm'ni 5-guruhga joyla" });

    expect(reply).toBe('Scheduled it.');
    expect(linkModule).toHaveBeenCalledWith(USER.id, 12, { moduleId: 5 });
    expect(addStudents).toHaveBeenCalledWith(USER.id, 12, { moduleId: 5 });
    expect(actions).toEqual([
      { tool: 'schedule_exam_to_group', args: { examId: 12, groupId: 5 }, ok: true, summary: expect.stringContaining('Scheduled exam 12 to group 5') },
    ]);
  });

  it('creates a group, then resolves a professor by name before adding them as its mentor', async () => {
    create
      .mockResolvedValueOnce(toolCallRound(toolCall('call_1', 'create_group', { name: 'AI class' })))
      .mockResolvedValueOnce(toolCallRound(toolCall('call_2', 'list_professors', { search: 'Bobur' })))
      .mockResolvedValueOnce(toolCallRound(toolCall('call_3', 'add_professor_to_group', { groupId: 40, professorId: 7 })))
      .mockResolvedValueOnce(finalRound('Done.'));
    (createModule as any).mockResolvedValue({ id: 40, name: 'AI class' });
    (listManagedProfessors as any).mockResolvedValue([{ id: 7, first_name: 'Bobur', last_name: null, email: 'bobur@magi.edu', professor_code: 'Bobur123' }]);
    (addProfessor as any).mockResolvedValue({ id: 7, first_name: 'Bobur', last_name: null, email: 'bobur@magi.edu' });

    const { reply, actions } = await runAssistant(USER, { message: "Create a new class named 'AI class' and assign teacher Bobur123 to it." });

    expect(reply).toBe('Done.');
    expect(createModule).toHaveBeenCalledWith(USER.id, { name: 'AI class' });
    expect(addProfessor).toHaveBeenCalledWith(USER.id, '40', { professorId: 7 });
    expect(actions.map((a) => a.tool)).toEqual(['create_group', 'list_professors', 'add_professor_to_group']);
    expect(actions.every((a) => a.ok)).toBe(true);
  });

  it('deletes a group once confirmed, passing the reason through', async () => {
    create
      .mockResolvedValueOnce(toolCallRound(toolCall('call_1', 'list_groups', {})))
      .mockResolvedValueOnce(toolCallRound(toolCall('call_2', 'delete_group', { groupId: 18, reason: 'requested by the professor' })))
      .mockResolvedValueOnce(finalRound('Deleted.'));
    (listModules as any).mockResolvedValue([{ id: 18, name: 'AI class', student_count: 0 }]);
    (deleteModule as any).mockResolvedValue(undefined);

    const { reply, actions } = await runAssistant(USER, { message: 'ha, AI class guruhini ochir' });

    expect(reply).toBe('Deleted.');
    expect(deleteModule).toHaveBeenCalledWith(USER.id, '18', { reason: 'requested by the professor' });
    expect(actions.map((a) => a.tool)).toEqual(['list_groups', 'delete_group']);
    expect(actions.every((a) => a.ok)).toBe(true);
  });

  it('refuses to delete a group id the model never actually looked up this turn', async () => {
    create
      .mockResolvedValueOnce(toolCallRound(toolCall('call_1', 'delete_group', { groupId: 1 })))
      .mockResolvedValueOnce(finalRound("Couldn't confirm that group."));

    const { actions } = await runAssistant(USER, { message: 'ha, 1-guruhni ochir' });

    expect(deleteModule).not.toHaveBeenCalled();
    expect(actions[0].ok).toBe(false);
    expect(actions[0].summary).toContain("hasn't been looked up yet this turn");
  });

  it('resolves a student by name before enrolling them in a group', async () => {
    create
      .mockResolvedValueOnce(toolCallRound(toolCall('call_1', 'list_students', { search: 'Sue' })))
      .mockResolvedValueOnce(toolCallRound(toolCall('call_2', 'add_student_to_group', { groupId: 7, studentId: 21 })))
      .mockResolvedValueOnce(finalRound('Enrolled.'));
    (listManagedStudents as any).mockResolvedValue([{ id: 21, first_name: 'Sue', last_name: 'Kim', email: 'sue@magi.edu', student_code: '44102' }]);
    (addStudent as any).mockResolvedValue({ id: 21, first_name: 'Sue', last_name: 'Kim', email: 'sue@magi.edu' });

    const { reply, actions } = await runAssistant(USER, { message: 'enroll Sue in group 7' });

    expect(reply).toBe('Enrolled.');
    expect(addStudent).toHaveBeenCalledWith(USER.id, '7', { studentId: 21 });
    expect(actions.map((a) => a.tool)).toEqual(['list_students', 'add_student_to_group']);
    expect(actions.every((a) => a.ok)).toBe(true);
  });

  it('enrolls a student directly by email, without needing list_students first', async () => {
    create
      .mockResolvedValueOnce(toolCallRound(toolCall('call_1', 'add_student_to_group', { groupId: 7, email: 'sue@magi.edu' })))
      .mockResolvedValueOnce(finalRound('Enrolled.'));
    (addStudent as any).mockResolvedValue({ id: 21, first_name: 'Sue', last_name: 'Kim', email: 'sue@magi.edu' });

    await runAssistant(USER, { message: 'enroll sue@magi.edu in group 7' });

    expect(addStudent).toHaveBeenCalledWith(USER.id, '7', { email: 'sue@magi.edu' });
  });

  it('extracts an attached text file and folds it into the message sent to the model', async () => {
    create.mockResolvedValueOnce(finalRound('Got it.'));
    const csv = Buffer.from('title,question\nQ1,What is 2+2?\n').toString('base64');

    await runAssistant(USER, { message: 'create questions from this file', file: { name: 'questions.csv', data: `data:text/csv;base64,${csv}` } });

    const sentMessages = create.mock.calls[0][0].messages;
    const userMessage = sentMessages.find((m: any) => m.role === 'user');
    expect(userMessage.content).toContain('<attached_file name="questions.csv">');
    expect(userMessage.content).toContain('What is 2+2?');
  });

  it('hands an attached image to the model as a real image, uploaded to persistent storage rather than inlined as base64', async () => {
    create.mockResolvedValueOnce(finalRound('I see it.'));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64').toString('base64');

    const { modelContent } = await runAssistant(USER, { message: 'what is this?', file: { name: 'photo.png', data: `data:image/png;base64,${png}` } });

    expect(uploadChatImage).toHaveBeenCalledWith(USER.id, `data:image/png;base64,${png}`);

    const sentMessages = create.mock.calls[0][0].messages;
    const userMessage = sentMessages.find((m: any) => m.role === 'user');
    expect(Array.isArray(userMessage.content)).toBe(true);
    expect(userMessage.content[0]).toEqual({ type: 'text', text: 'what is this?' });
    expect(userMessage.content[1]).toEqual({ type: 'image_url', image_url: { url: 'https://cdn.example.com/ai-chat/9/photo.png' } });

    // persisted so a later turn's reconstructed history can hand the same image back to the model
    expect(modelContent).toBe('what is this?\n\n<attached_image url="https://cdn.example.com/ai-chat/9/photo.png" />');
  });

  it("reconstructs a persisted image from an earlier turn's history back into a real image again", async () => {
    create.mockResolvedValueOnce(finalRound('That earlier one was a cat.'));
    const history = [
      { role: 'user' as const, content: 'what is this?\n\n<attached_image url="https://cdn.example.com/ai-chat/9/cat.png" />' },
      { role: 'assistant' as const, content: "It's a photo." },
    ];

    await runAssistant(USER, { message: 'was that a cat or a dog?', history });

    const sentMessages = create.mock.calls[0][0].messages;
    const historicalUserMessage = sentMessages.find((m: any) => m.role === 'user' && Array.isArray(m.content));
    expect(historicalUserMessage.content[0]).toEqual({ type: 'text', text: 'what is this?' });
    expect(historicalUserMessage.content[1]).toEqual({ type: 'image_url', image_url: { url: 'https://cdn.example.com/ai-chat/9/cat.png' } });
  });

  it("collapses an earlier turn's attached file text to a short note, instead of re-sending it on every later message", async () => {
    create.mockResolvedValueOnce(finalRound('Noted.'));
    const bigDocument = 'x'.repeat(20_000);
    const history = [
      {
        role: 'user' as const,
        content: `shu ro'yxatdagi savollarni qo'sh\n\n<attached_file name="questions.csv">\n${bigDocument}\n</attached_file>`,
      },
      { role: 'assistant' as const, content: "Qo'shdim, 20 ta savol yaratildi." },
    ];

    await runAssistant(USER, { message: 'yana nechta savol qoldi?', history });

    const sentMessages = create.mock.calls[0][0].messages;
    const historicalUserMessage = sentMessages.find((m: any) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('attached_file'));
    expect(historicalUserMessage.content).not.toContain(bigDocument);
    expect(historicalUserMessage.content).toContain('<attached_file name="questions.csv">[content omitted from history to save tokens');
    expect(historicalUserMessage.content.length).toBeLessThan(300);
  });

  it('resolves a pasted Google Docs link the same way an attached file would, without a file being attached at all', async () => {
    create.mockResolvedValueOnce(finalRound('Added both questions.'));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['title', 'question'], ['Q1', 'What is 2+2?']]), 'Sheet1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
    }));

    const { modelContent } = await runAssistant(USER, {
      message: "shu jadvaldagi savollarni qo'sh: https://docs.google.com/spreadsheets/d/1Sheet99/edit",
    });

    expect(globalThis.fetch).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/1Sheet99/export?format=xlsx', { redirect: 'follow' });
    expect(modelContent).toContain('<attached_file name="google-sheet.xlsx">');
    expect(modelContent).toContain('What is 2+2?');
  });

  it('renames a group, removes a student, and removes a professor', async () => {
    create
      .mockResolvedValueOnce(toolCallRound(toolCall('call_1', 'rename_group', { groupId: 7, name: 'Algorithms II' })))
      .mockResolvedValueOnce(toolCallRound(toolCall('call_2', 'remove_student_from_group', { groupId: 7, studentId: 21 })))
      .mockResolvedValueOnce(toolCallRound(toolCall('call_3', 'remove_professor_from_group', { groupId: 7, professorId: 5 })))
      .mockResolvedValueOnce(finalRound('Done.'));
    (updateModule as any).mockResolvedValue({ id: 7, name: 'Algorithms II' });
    (removeStudent as any).mockResolvedValue(undefined);
    (removeProfessor as any).mockResolvedValue(undefined);

    const { reply, actions } = await runAssistant(USER, { message: 'rename group 7, remove student 21 and professor 5 from it' });

    expect(reply).toBe('Done.');
    expect(updateModule).toHaveBeenCalledWith(USER.id, '7', { name: 'Algorithms II' });
    expect(removeStudent).toHaveBeenCalledWith(USER.id, '7', '21');
    expect(removeProfessor).toHaveBeenCalledWith(USER.id, '7', '5');
    expect(actions.every((a) => a.ok)).toBe(true);
  });

  it("renames a student's profile", async () => {
    create
      .mockResolvedValueOnce(toolCallRound(toolCall('call_1', 'update_student', { studentId: 21, firstName: 'Humoyun' })))
      .mockResolvedValueOnce(finalRound('Renamed.'));
    (updateStudentProfile as any).mockResolvedValue(undefined);

    const { reply, actions } = await runAssistant(USER, { message: "21-talabaning ismini Humoyun deb o'zgartir" });

    expect(reply).toBe('Renamed.');
    expect(updateStudentProfile).toHaveBeenCalledWith(USER.id, 21, { firstName: 'Humoyun' });
    expect(actions.every((a) => a.ok)).toBe(true);
  });

  it('updates an exam, changes its status, edits a question, and detaches it', async () => {
    create
      .mockResolvedValueOnce(toolCallRound(toolCall('call_1', 'update_exam', { examId: 12, name: 'Midterm (resit)' })))
      .mockResolvedValueOnce(toolCallRound(toolCall('call_2', 'set_exam_status', { examId: 12, status: 'delayed' })))
      .mockResolvedValueOnce(toolCallRound(toolCall('call_3', 'update_question', { questionId: 9, title: 'Updated title' })))
      .mockResolvedValueOnce(toolCallRound(toolCall('call_4', 'remove_question_from_exam', { examId: 12, questionId: 9 })))
      .mockResolvedValueOnce(finalRound('Done.'));
    (updateExam as any).mockResolvedValue({ id: 12, name: 'Midterm (resit)' });
    (setExamStatus as any).mockResolvedValue({ id: 12, status: 'delayed' });
    (updateQuestion as any).mockResolvedValue({ id: 9, title: 'Updated title' });
    (detachQuestion as any).mockResolvedValue(undefined);

    const { actions } = await runAssistant(USER, { message: 'update exam 12, delay it, rename question 9, and detach it' });

    expect(updateExam).toHaveBeenCalledWith(USER.id, 12, { examId: 12, name: 'Midterm (resit)' });
    expect(setExamStatus).toHaveBeenCalledWith(USER.id, 12, { status: 'delayed' });
    expect(updateQuestion).toHaveBeenCalledWith(USER.id, '9', { questionId: 9, title: 'Updated title' });
    expect(detachQuestion).toHaveBeenCalledWith(USER.id, 12, 9);
    expect(actions.every((a) => a.ok)).toBe(true);
  });

  it('lists attempts for an exam, looks one up, and grades it once confirmed', async () => {
    create
      .mockResolvedValueOnce(toolCallRound(toolCall('call_1', 'list_exam_attempts', { examId: 12, status: 'submitted' })))
      .mockResolvedValueOnce(toolCallRound(toolCall('call_2', 'get_attempt', { attemptId: 77 })))
      .mockResolvedValueOnce(finalRound("Sue scored 8/10 on question 1 (essay). Confirm a score of 85/100 with feedback 'Good work'?"));
    (listExamAttempts as any).mockResolvedValue([
      { id: 77, status: 'submitted', score: null, passed: null, submitted_at: '2026-01-01T00:00:00Z', student: { id: 21, first_name: 'Sue', last_name: 'Kim', email: 'sue@magi.edu' } },
    ]);
    (getAttempt as any).mockResolvedValue({
      id: 77, status: 'submitted', score: null, feedback: null,
      exam: { id: 12, name: 'Midterm', max_marks: 100 },
      student: { id: 21, first_name: 'Sue', last_name: 'Kim', email: 'sue@magi.edu' },
      questions: [{ question_id: 9, title: 'Essay', question: 'Explain recursion.', answer: 'It calls itself.', marks: 10, marks_awarded: 8, options: [], selected_option_ids: [] }],
    });

    const { reply, actions } = await runAssistant(USER, { message: "Midterm testida Sue'ning javoblarini korsat" });

    expect(reply).toContain('Confirm');
    expect(listExamAttempts).toHaveBeenCalledWith({ id: USER.id, role: 'professor' }, { examId: 12, status: 'submitted' });
    expect(getAttempt).toHaveBeenCalledWith({ id: USER.id, role: 'professor' }, 77);
    expect(gradeAttempt).not.toHaveBeenCalled();
    expect(actions.map((a) => a.tool)).toEqual(['list_exam_attempts', 'get_attempt']);
  });

  it('grades an attempt once the professor confirms, notifying the student via the service', async () => {
    // new message, so it has to look the attempt up again before grading
    create
      .mockResolvedValueOnce(toolCallRound(toolCall('call_1', 'get_attempt', { attemptId: 77 })))
      .mockResolvedValueOnce(toolCallRound(toolCall('call_2', 'grade_attempt', { attemptId: 77, score: 85, feedback: 'Good work' })))
      .mockResolvedValueOnce(finalRound('Graded.'));
    (getAttempt as any).mockResolvedValue({
      id: 77, status: 'submitted', score: null, feedback: null,
      exam: { id: 12, name: 'Midterm', max_marks: 100 },
      student: { id: 21, first_name: 'Sue', last_name: 'Kim', email: 'sue@magi.edu' },
      questions: [{ question_id: 9, title: 'Essay', question: 'Explain recursion.', answer: 'It calls itself.', marks: 10, marks_awarded: 8, options: [], selected_option_ids: [] }],
    });
    (gradeAttempt as any).mockResolvedValue({ score: 85, status: 'graded' });

    const history = [
      { role: 'user' as const, content: "Midterm testida Sue'ning javoblarini korsat" },
      { role: 'assistant' as const, content: "Sue scored 8/10 on question 1 (essay). Confirm a score of 85/100 with feedback 'Good work'?" },
    ];
    const { reply, actions } = await runAssistant(USER, { message: 'ha', history });

    expect(reply).toBe('Graded.');
    expect(getAttempt).toHaveBeenCalledWith({ id: USER.id, role: 'professor' }, 77);
    expect(gradeAttempt).toHaveBeenCalledWith(USER.id, 77, { score: 85, feedback: 'Good work' });
    expect(actions.map((a) => a.tool)).toEqual(['get_attempt', 'grade_attempt']);
    expect(actions.every((a) => a.ok)).toBe(true);
  });

  it('refuses to grade an attempt id the model never actually looked up this turn', async () => {
    create
      .mockResolvedValueOnce(toolCallRound(toolCall('call_1', 'grade_attempt', { attemptId: 9999, score: 85 })))
      .mockResolvedValueOnce(finalRound("Couldn't confirm that attempt."));

    const { actions } = await runAssistant(USER, { message: 'grade attempt 9999 with 85' });

    expect(gradeAttempt).not.toHaveBeenCalled();
    expect(actions[0].ok).toBe(false);
    expect(actions[0].summary).toContain("hasn't been looked up yet this turn");
  });

  it('runs the AI review on an attempt', async () => {
    create
      .mockResolvedValueOnce(toolCallRound(toolCall('call_1', 'get_attempt', { attemptId: 77 })))
      .mockResolvedValueOnce(toolCallRound(toolCall('call_2', 'trigger_ai_review', { attemptId: 77 })))
      .mockResolvedValueOnce(finalRound('Reviewed.'));
    (getAttempt as any).mockResolvedValue({
      id: 77, status: 'submitted', score: null, feedback: null,
      exam: { id: 12, name: 'Midterm', max_marks: 100 },
      student: { id: 21, first_name: 'Sue', last_name: 'Kim', email: 'sue@magi.edu' },
      questions: [],
    });
    (aiReviewAttempt as any).mockResolvedValue({ cheating_likelihood: 'low', cheating_reasoning: 'Nothing unusual.', per_question: [] });

    const { reply } = await runAssistant(USER, { message: "77-attemptni korib chiq, keyin AI review ishga tushir" });

    expect(reply).toBe('Reviewed.');
    expect(aiReviewAttempt).toHaveBeenCalledWith(USER.id, 77, false);
  });

  it('reopens an attempt for a retake once the professor confirms', async () => {
    create
      .mockResolvedValueOnce(toolCallRound(toolCall('call_1', 'get_attempt', { attemptId: 77 })))
      .mockResolvedValueOnce(toolCallRound(toolCall('call_2', 'allow_retake', { attemptId: 77 })))
      .mockResolvedValueOnce(finalRound('Reopened.'));
    (getAttempt as any).mockResolvedValue({
      id: 77, status: 'submitted', score: 40, feedback: null,
      exam: { id: 12, name: 'Midterm', max_marks: 100 },
      student: { id: 21, first_name: 'Sue', last_name: 'Kim', email: 'sue@magi.edu' },
      questions: [],
    });
    (allowRetake as any).mockResolvedValue({ status: 'in_progress', unlimited_time: true });

    const { reply, actions } = await runAssistant(USER, { message: "Sue'ning 77-attemptiga qayta topshirishga ruxsat ber" });

    expect(reply).toBe('Reopened.');
    expect(allowRetake).toHaveBeenCalledWith(USER.id, 77);
    expect(actions.map((a) => a.tool)).toEqual(['get_attempt', 'allow_retake']);
    expect(actions.every((a) => a.ok)).toBe(true);
  });

  it('refuses to reopen an attempt id the model never actually looked up this turn', async () => {
    create
      .mockResolvedValueOnce(toolCallRound(toolCall('call_1', 'allow_retake', { attemptId: 9999 })))
      .mockResolvedValueOnce(finalRound("Couldn't confirm that attempt."));

    const { actions } = await runAssistant(USER, { message: 'attempt 9999ga qayta topshirishga ruxsat ber' });

    expect(allowRetake).not.toHaveBeenCalled();
    expect(actions[0].ok).toBe(false);
    expect(actions[0].summary).toContain("hasn't been looked up yet this turn");
  });

  it('lists the grading overview across all exams', async () => {
    create
      .mockResolvedValueOnce(toolCallRound(toolCall('call_1', 'list_attempts_summary', {})))
      .mockResolvedValueOnce(finalRound('Here is the overview.'));
    (listAttemptsSummary as any).mockResolvedValue([{ exam_id: 12, students: 20, awaiting: 3, graded: 17 }]);

    await runAssistant(USER, { message: 'qaysi testlarim baholashni kutmoqda' });

    expect(listAttemptsSummary).toHaveBeenCalledWith(USER.id);
  });

  it("turns a tool's HttpError into a {error} tool result instead of throwing", async () => {
    create
      .mockResolvedValueOnce(toolCallRound(toolCall('call_1', 'get_exam', { examId: 99 })))
      .mockResolvedValueOnce(finalRound("That exam doesn't exist."));
    (getExam as any).mockRejectedValue(new HttpError(404, 'Exam not found'));

    const { reply, actions } = await runAssistant(USER, { message: 'show me exam 99' });

    expect(reply).toBe("That exam doesn't exist.");
    expect(actions).toEqual([{ tool: 'get_exam', args: { examId: 99 }, ok: false, summary: 'Exam not found' }]);

    // the model has to see the failure to explain it back - not a crash, a tool-result message
    const secondCallMessages = create.mock.calls[1][0].messages;
    const toolMessage = secondCallMessages.find((m: any) => m.role === 'tool');
    expect(JSON.parse(toolMessage.content)).toEqual({ error: 'Exam not found' });
  });

  it('reports an unknown tool name back to the model instead of crashing', async () => {
    create
      .mockResolvedValueOnce(toolCallRound(toolCall('call_1', 'delete_everything', {})))
      .mockResolvedValueOnce(finalRound("I can't do that."));

    const { actions } = await runAssistant(USER, { message: 'do something unsupported' });

    expect(actions).toEqual([{ tool: 'delete_everything', args: {}, ok: false, summary: 'Unknown tool: delete_everything' }]);
  });

  it('stops after 6 rounds if the model never settles on a plain reply', async () => {
    create.mockResolvedValue(toolCallRound(toolCall('call_x', 'list_groups', {})));
    (listModules as any).mockResolvedValue([]);

    const { reply } = await runAssistant(USER, { message: 'keep going' });

    expect(create).toHaveBeenCalledTimes(6);
    expect(reply).toContain("wasn't able to finish");
  });
});
