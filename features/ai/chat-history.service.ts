// Persists the Magi AI chat (see assistant.service.ts) so it survives closing the panel or
// reloading the page - one row per message, scoped to the professor who sent/received it.
import { database } from '../../lib/db.js';

export type ChatHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
  actions: unknown;
  fileName: string | null;
  createdAt: string;
};

// capped so a long-running conversation doesn't balloon the payload every time the panel opens
const HISTORY_LIMIT = 50;

export const getChatHistory = async (professorId: number): Promise<ChatHistoryMessage[]> => {
  const { data, error } = await database
    .from('ai_chat_messages')
    .select('role, content, actions, file_name, created_at')
    .eq('professor_id', professorId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row: any) => ({ role: row.role, content: row.content, actions: row.actions, fileName: row.file_name, createdAt: row.created_at }))
    .reverse();
};

// best-effort, same as lib/notifications.ts's notify: a history row failing to save must never
// break the chat reply that already went back to the professor
export const saveChatMessage = async (
  professorId: number,
  role: 'user' | 'assistant',
  content: string,
  actions?: unknown,
  fileName?: string | null,
): Promise<void> => {
  // node-postgres sends a plain JS array/object as a Postgres array literal, not JSON text - jsonb
  // columns need the JSON text itself, hence the explicit stringify (reads back already-parsed,
  // via pg's own default jsonb type parser)
  const { error } = await database
    .from('ai_chat_messages')
    .insert({ professor_id: professorId, role, content, actions: actions !== undefined ? JSON.stringify(actions) : null, file_name: fileName ?? null });
  if (error) console.log('Error saving AI chat message:', error.message);
};
