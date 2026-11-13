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
  for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'limit']) {
    builder[method] = vi.fn(() => builder);
  };
  const from = vi.fn(() => builder);
  return { from, builder, results };
});

vi.mock('../../../lib/db.js', () => ({ database: { from } }));

import { listConversations, createConversation, getConversationMessages, deleteConversation, saveChatMessage } from '../../../features/ai/chat-history.service.js';
import { HttpError } from '../../../lib/errors.js';

const ok = (data: unknown) => ({ data, error: null });
const fail = (error: unknown) => ({ data: null, error });
const queue = (...items: { data: unknown; error: unknown }[]) => results.push(...items);

const rejected = async (promise: Promise<unknown>): Promise<any> => promise.then(() => null, (error) => error);

beforeEach(() => {
  results.length = 0;
  from.mockClear();
  for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'limit', 'single', 'maybeSingle']) {
    builder[method].mockClear();
  };
});

describe('listConversations', () => {
  it('returns the most recently active first, as given', async () => {
    queue(ok([{ id: 2, title: 'Recent', updated_at: '2026-01-02T00:00:00Z' }, { id: 1, title: null, updated_at: '2026-01-01T00:00:00Z' }]));

    const conversations = await listConversations(9);

    expect(conversations).toEqual([
      { id: 2, title: 'Recent', updatedAt: '2026-01-02T00:00:00Z' },
      { id: 1, title: null, updatedAt: '2026-01-01T00:00:00Z' },
    ]);
    expect(builder.eq).toHaveBeenCalledWith('professor_id', 9);
    expect(builder.order).toHaveBeenCalledWith('updated_at', { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(50);
  });
});

describe('createConversation', () => {
  it('inserts a titleless conversation and returns it', async () => {
    queue(ok({ id: 5, title: null, updated_at: '2026-01-01T00:00:00Z' }));

    const conversation = await createConversation(9);

    expect(conversation).toEqual({ id: 5, title: null, updatedAt: '2026-01-01T00:00:00Z' });
    expect(builder.insert).toHaveBeenCalledWith({ professor_id: 9 });
  });
});

describe('getConversationMessages', () => {
  it("404s on a conversation that belongs to someone else", async () => {
    queue(ok({ id: 5, professor_id: 123 }));

    const error = await rejected(getConversationMessages(9, 5));

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(404);
  });

  it('returns messages oldest-first once ownership checks out, including modelContent', async () => {
    queue(ok({ id: 5, professor_id: 9 }));
    queue(ok([
      { role: 'user', content: 'Hi', model_content: null, actions: null, file_name: null, created_at: '2026-01-01T00:00:00Z' },
      {
        role: 'user', content: 'what is this?',
        model_content: 'what is this?\n\n<attached_image url="https://cdn.example.com/x.png" />',
        actions: null, file_name: 'photo.png', created_at: '2026-01-01T00:00:01Z',
      },
    ]));

    const messages = await getConversationMessages(9, 5);

    expect(messages).toEqual([
      { role: 'user', content: 'Hi', modelContent: null, actions: null, fileName: null, createdAt: '2026-01-01T00:00:00Z' },
      {
        role: 'user', content: 'what is this?',
        modelContent: 'what is this?\n\n<attached_image url="https://cdn.example.com/x.png" />',
        actions: null, fileName: 'photo.png', createdAt: '2026-01-01T00:00:01Z',
      },
    ]);
    expect(builder.eq).toHaveBeenCalledWith('conversation_id', 5);
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: true });
  });
});

describe('deleteConversation', () => {
  it("404s on a conversation that doesn't exist", async () => {
    queue(ok(null));

    const error = await rejected(deleteConversation(9, 5));

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(404);
  });

  it('deletes once ownership checks out', async () => {
    queue(ok({ id: 5, professor_id: 9 }));
    queue(ok(null));

    await deleteConversation(9, 5);

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenLastCalledWith('id', 5);
  });
});

describe('saveChatMessage', () => {
  it('inserts a row, JSON-stringifying actions, and bumps updated_at without a title (assistant turn)', async () => {
    queue(ok(null)); // insert

    await saveChatMessage(5, 'assistant', 'Done.', [{ tool: 'rename_group', args: {}, ok: true, summary: 'Renamed' }], null);

    expect(builder.insert).toHaveBeenNthCalledWith(1, {
      conversation_id: 5,
      role: 'assistant',
      content: 'Done.',
      model_content: null,
      actions: JSON.stringify([{ tool: 'rename_group', args: {}, ok: true, summary: 'Renamed' }]),
      file_name: null,
    });
    expect(builder.update).toHaveBeenCalledTimes(1);
    const [patch] = builder.update.mock.calls[0];
    expect(patch.title).toBeUndefined();
    expect(typeof patch.updated_at).toBe('string');
  });

  it('persists modelContent separately from the displayed content, when given', async () => {
    queue(ok(null)); // insert
    queue(ok({ title: 'Already set' })); // existing title check

    await saveChatMessage(5, 'user', 'what is this?', undefined, 'photo.png', 'what is this?\n\n<attached_image url="https://cdn.example.com/x.png" />');

    expect(builder.insert).toHaveBeenNthCalledWith(1, {
      conversation_id: 5,
      role: 'user',
      content: 'what is this?',
      model_content: 'what is this?\n\n<attached_image url="https://cdn.example.com/x.png" />',
      actions: null,
      file_name: 'photo.png',
    });
  });

  it("auto-titles the conversation from a user's first message, but not a later one", async () => {
    queue(ok(null)); // insert
    queue(ok({ title: null })); // existing title check

    await saveChatMessage(5, 'user', '  Midterm testini 5-guruhga joyla   extra  spaces  ');

    const [patch] = builder.update.mock.calls[0];
    expect(patch.title).toBe('Midterm testini 5-guruhga joyla extra spaces');

    builder.update.mockClear();
    queue(ok(null)); // insert
    queue(ok({ title: 'Already set' })); // existing title check

    await saveChatMessage(5, 'user', 'A follow-up message');

    const [laterPatch] = builder.update.mock.calls[0];
    expect(laterPatch.title).toBeUndefined();
  });

  it('never throws on a write failure - logs and moves on', async () => {
    queue(fail({ message: 'boom' }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(saveChatMessage(5, 'user', 'hi')).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith('Error saving AI chat message:', 'boom');
    expect(builder.update).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });
});
