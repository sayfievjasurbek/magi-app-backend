import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/ai.js', () => ({ getClient: vi.fn() }));
vi.mock('../../../features/modules/module.service.js', () => ({
  listModules: vi.fn(), getRoster: vi.fn(), createModule: vi.fn(), addProfessor: vi.fn(), deleteModule: vi.fn(), addStudent: vi.fn(),
}));
vi.mock('../../../features/exams/exam.service.js', () => ({
  listExams: vi.fn(), getExam: vi.fn(), createExam: vi.fn(), linkModule: vi.fn(), addStudents: vi.fn(), attachQuestion: vi.fn(),
}));
vi.mock('../../../features/questions/question.service.js', () => ({ listQuestions: vi.fn(), createQuestion: vi.fn() }));
vi.mock('../../../features/attendance/attendance.service.js', () => ({ getAttendance: vi.fn(), setAttendance: vi.fn() }));
vi.mock('../../../features/cheatings/cheating.service.js', () => ({ examSummary: vi.fn() }));
vi.mock('../../../features/auth/auth.controller.js', () => ({ listManagedProfessors: vi.fn(), listManagedStudents: vi.fn() }));

import { runAssistant } from '../../../features/ai/assistant.service.js';
import { getClient } from '../../../lib/ai.js';
import { listModules, createModule, addProfessor, deleteModule, addStudent } from '../../../features/modules/module.service.js';
import { getExam, linkModule, addStudents } from '../../../features/exams/exam.service.js';
import { listManagedProfessors, listManagedStudents } from '../../../features/auth/auth.controller.js';
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
      .mockResolvedValueOnce(toolCallRound(toolCall('call_1', 'delete_group', { groupId: 18, reason: 'requested by the professor' })))
      .mockResolvedValueOnce(finalRound('Deleted.'));
    (deleteModule as any).mockResolvedValue(undefined);

    const { reply, actions } = await runAssistant(USER, { message: 'ha, AI class guruhini ochir' });

    expect(reply).toBe('Deleted.');
    expect(deleteModule).toHaveBeenCalledWith(USER.id, '18', { reason: 'requested by the professor' });
    expect(actions).toEqual([
      { tool: 'delete_group', args: { groupId: 18, reason: 'requested by the professor' }, ok: true, summary: 'Deleted group 18' },
    ]);
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

  it('hands an attached image to the model as a real image, not extracted text', async () => {
    create.mockResolvedValueOnce(finalRound('I see it.'));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64').toString('base64');

    await runAssistant(USER, { message: 'what is this?', file: { name: 'photo.png', data: `data:image/png;base64,${png}` } });

    const sentMessages = create.mock.calls[0][0].messages;
    const userMessage = sentMessages.find((m: any) => m.role === 'user');
    expect(Array.isArray(userMessage.content)).toBe(true);
    expect(userMessage.content[0]).toEqual({ type: 'text', text: 'what is this?' });
    expect(userMessage.content[1].type).toBe('image_url');
    expect(userMessage.content[1].image_url.url).toContain('data:image/png;base64,');
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
