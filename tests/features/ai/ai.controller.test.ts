import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../features/ai/chat-history.service.js', () => ({
  createConversation: vi.fn(),
  getConversationMessages: vi.fn(),
  listConversations: vi.fn(),
  deleteConversation: vi.fn(),
  saveChatMessage: vi.fn(),
}));

import { resolveConversation } from '../../../features/ai/ai.controller.js';
import { createConversation, getConversationMessages } from '../../../features/ai/chat-history.service.js';
import { HttpError } from '../../../lib/errors.js';

describe('resolveConversation', () => {
  it('creates a new conversation when none is given', async () => {
    (createConversation as any).mockResolvedValue({ id: 5, title: null, updatedAt: '2026-01-01T00:00:00Z' });

    const result = await resolveConversation(9, undefined);

    expect(result).toEqual({ conversationId: 5, history: [] });
  });

  it("loads an existing conversation's history, mapped to role/content only", async () => {
    (getConversationMessages as any).mockResolvedValue([
      { role: 'user', content: 'Hi', actions: null, fileName: null, createdAt: '2026-01-01T00:00:00Z' },
      { role: 'assistant', content: 'Hello', actions: [{ tool: 'list_groups', args: {}, ok: true, summary: 'Listed 1 group(s)' }], fileName: null, createdAt: '2026-01-01T00:00:01Z' },
    ]);

    const result = await resolveConversation(9, 5);

    expect(result).toEqual({
      conversationId: 5,
      history: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }],
    });
  });

  it('rejects a non-integer conversation id as the professor\'s own mistake', async () => {
    await expect(resolveConversation(9, 'not-a-number')).rejects.toBeInstanceOf(HttpError);
  });

  it('lets a real 404 (unowned/missing conversation) surface, not swallowed', async () => {
    (getConversationMessages as any).mockRejectedValue(new HttpError(404, 'Conversation not found'));

    const error: any = await resolveConversation(9, 5).catch((e) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(404);
  });

  it('falls back to an unsaved conversation instead of failing when persistence itself is down', async () => {
    (createConversation as any).mockRejectedValue(new Error('relation "ai_chat_conversations" does not exist'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await resolveConversation(9, undefined);

    expect(result).toEqual({ conversationId: null, history: [] });
    expect(logSpy).toHaveBeenCalled();

    logSpy.mockRestore();
  });
});
