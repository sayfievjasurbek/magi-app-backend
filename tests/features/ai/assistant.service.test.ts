import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/ai.js', () => ({ getClient: vi.fn(), MODEL: 'gpt-test' }));
vi.mock('../../../features/modules/module.service.js', () => ({ listModules: vi.fn(), getRoster: vi.fn() }));
vi.mock('../../../features/exams/exam.service.js', () => ({
  listExams: vi.fn(), getExam: vi.fn(), createExam: vi.fn(), linkModule: vi.fn(), addStudents: vi.fn(), attachQuestion: vi.fn(),
}));
vi.mock('../../../features/questions/question.service.js', () => ({ listQuestions: vi.fn(), createQuestion: vi.fn() }));
vi.mock('../../../features/attendance/attendance.service.js', () => ({ getAttendance: vi.fn(), setAttendance: vi.fn() }));
vi.mock('../../../features/cheatings/cheating.service.js', () => ({ examSummary: vi.fn() }));

import { runAssistant } from '../../../features/ai/assistant.service.js';
import { getClient } from '../../../lib/ai.js';
import { listModules } from '../../../features/modules/module.service.js';
import { getExam, linkModule, addStudents } from '../../../features/exams/exam.service.js';
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
