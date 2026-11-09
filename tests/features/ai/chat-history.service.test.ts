import { describe, it, expect, vi, beforeEach } from 'vitest';

// one chainable fake for the whole client: every awaited call takes the next queued { data, error }
const { from, builder, results } = vi.hoisted(() => {
  const results: { data: unknown; error: unknown }[] = [];
  const take = () => results.shift() ?? { data: null, error: null };
  const builder: Record<string, any> = {
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(take()).then(resolve),
  };
  for (const method of ['select', 'insert', 'eq', 'order', 'limit']) {
    builder[method] = vi.fn(() => builder);
  };
  const from = vi.fn(() => builder);
  return { from, builder, results };
});

vi.mock('../../../lib/db.js', () => ({ database: { from } }));

import { getChatHistory, saveChatMessage } from '../../../features/ai/chat-history.service.js';

const ok = (data: unknown) => ({ data, error: null });
const fail = (error: unknown) => ({ data: null, error });
const queue = (...items: { data: unknown; error: unknown }[]) => results.push(...items);

beforeEach(() => {
  results.length = 0;
  from.mockClear();
  builder.select.mockClear();
  builder.insert.mockClear();
  builder.order.mockClear();
  builder.limit.mockClear();
});

describe('getChatHistory', () => {
  it('returns the newest 50 oldest-first, mapping file_name/created_at to camelCase', async () => {
    queue(
      ok([
        { role: 'assistant', content: 'Hi again', actions: [{ tool: 'list_groups', args: {}, ok: true, summary: 'Listed 2 group(s)' }], file_name: null, created_at: '2026-01-02T00:00:00Z' },
        { role: 'user', content: 'Hello', actions: null, file_name: 'roster.csv', created_at: '2026-01-01T00:00:00Z' },
      ]),
    );

    const history = await getChatHistory(9);

    // the query fetches newest-first (for the LIMIT to keep the most recent ones) - the service
    // reverses it back to oldest-first for display
    expect(history).toEqual([
      { role: 'user', content: 'Hello', actions: null, fileName: 'roster.csv', createdAt: '2026-01-01T00:00:00Z' },
      { role: 'assistant', content: 'Hi again', actions: [{ tool: 'list_groups', args: {}, ok: true, summary: 'Listed 2 group(s)' }], fileName: null, createdAt: '2026-01-02T00:00:00Z' },
    ]);
    expect(builder.eq).toHaveBeenCalledWith('professor_id', 9);
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(50);
  });

  it('throws on a query error', async () => {
    queue(fail({ message: 'boom' }));
    await expect(getChatHistory(9)).rejects.toThrow('boom');
  });
});

describe('saveChatMessage', () => {
  it('inserts a row, JSON-stringifying actions for the jsonb column', async () => {
    queue(ok(null));

    await saveChatMessage(9, 'assistant', 'Done.', [{ tool: 'rename_group', args: {}, ok: true, summary: 'Renamed' }], null);

    expect(builder.insert).toHaveBeenCalledWith({
      professor_id: 9,
      role: 'assistant',
      content: 'Done.',
      actions: JSON.stringify([{ tool: 'rename_group', args: {}, ok: true, summary: 'Renamed' }]),
      file_name: null,
    });
  });

  it('never throws on a write failure - logs and moves on', async () => {
    queue(fail({ message: 'boom' }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(saveChatMessage(9, 'user', 'hi')).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith('Error saving AI chat message:', 'boom');

    logSpy.mockRestore();
  });
});
