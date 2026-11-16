import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../features/ai/ai.service.js', () => ({
  runAssistant: vi.fn(),
  createConversation: vi.fn(),
  getConversationMessages: vi.fn(),
  listConversations: vi.fn(),
  deleteConversation: vi.fn(),
  saveChatMessage: vi.fn(),
}));

import { resolveConversation } from '../../../features/ai/ai.controller.js';
import { createConversation, getConversationMessages } from '../../../features/ai/ai.service.js';
import { HttpError } from '../../../lib/errors.js';

describe('resolveConversation', () => {
  it('creates a new conversation when none is given', async () => {
    (createConversation as any).mockResolvedValue({ id: 5, title: null, updatedAt: '2026-01-01T00:00:00Z' });

    const result = await resolveConversation(9, undefined, []);

    expect(result).toEqual({ conversationId: 5, history: [] });
  });

  it("loads an existing conversation's history, mapped to role/content only - ignoring any client history", async () => {
    (getConversationMessages as any).mockResolvedValue([
      { role: 'user', content: 'Hi', actions: null, fileName: null, createdAt: '2026-01-01T00:00:00Z' },
      { role: 'assistant', content: 'Hello', actions: [{ tool: 'list_groups', args: {}, ok: true, summary: 'Listed 1 group(s)' }], fileName: null, createdAt: '2026-01-01T00:00:01Z' },
    ]);

    const result = await resolveConversation(9, 5, [{ role: 'user', content: 'a client-supplied message that should be ignored' }]);

    expect(result).toEqual({
      conversationId: 5,
      history: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }],
    });
  });

  it("prefers modelContent over content when building history, so a model can see what's in an attached file/image again", async () => {
    (getConversationMessages as any).mockResolvedValue([
      {
        role: 'user', content: 'what is this?',
        modelContent: 'what is this?\n\n<attached_image url="https://cdn.example.com/x.png" />',
        actions: null, fileName: 'photo.png', createdAt: '2026-01-01T00:00:00Z',
      },
      { role: 'assistant', content: "It's a cat.", modelContent: null, actions: null, fileName: null, createdAt: '2026-01-01T00:00:01Z' },
    ]);

    const result = await resolveConversation(9, 5, []);

    expect(result.history).toEqual([
      { role: 'user', content: 'what is this?\n\n<attached_image url="https://cdn.example.com/x.png" />' },
      { role: 'assistant', content: "It's a cat." },
    ]);
  });

  it('rejects a non-integer conversation id as the professor\'s own mistake', async () => {
    await expect(resolveConversation(9, 'not-a-number', [])).rejects.toBeInstanceOf(HttpError);
  });

  it('lets a real 404 (unowned/missing conversation) surface, not swallowed', async () => {
    (getConversationMessages as any).mockRejectedValue(new HttpError(404, 'Conversation not found'));

    const error: any = await resolveConversation(9, 5, []).catch((e) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(404);
  });

  it('falls back to an unsaved conversation instead of failing when persistence itself is down', async () => {
    (createConversation as any).mockRejectedValue(new Error('relation "ai_chat_conversations" does not exist'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await resolveConversation(9, undefined, []);

    expect(result).toEqual({ conversationId: null, history: [] });
    expect(logSpy).toHaveBeenCalled();

    logSpy.mockRestore();
  });

  it("falls back to the client's own tracked history when persistence is down, so context isn't lost mid-session", async () => {
    (getConversationMessages as any).mockRejectedValue(new Error('relation "ai_chat_conversations" does not exist'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const clientHistory = [{ role: 'user', content: "men shu guruhni o'chirib yubormoqchiman" }, { role: 'assistant', content: 'Qaysi guruhni?' }];
    const result = await resolveConversation(9, 5, clientHistory);

    expect(result).toEqual({ conversationId: null, history: clientHistory });

    logSpy.mockRestore();
  });
});
