// Persists the Magi AI chat as separate conversations (see assistant.service.ts) - a sidebar of
// past conversations a professor can switch between, same shape as ChatGPT/Claude.ai, so it
// survives closing the panel or reloading the page.
import { database } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';

export type Conversation = { id: number; title: string | null; updatedAt: string };

export type ChatHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
  actions: unknown;
  fileName: string | null;
  createdAt: string;
};

// caps so a professor who's been chatting for months doesn't balloon either payload
const CONVERSATION_LIMIT = 50;
const MESSAGE_LIMIT = 200;
const TITLE_LENGTH = 48;

export const listConversations = async (professorId: number): Promise<Conversation[]> => {
  const { data, error } = await database
    .from('ai_chat_conversations')
    .select('id, title, updated_at')
    .eq('professor_id', professorId)
    .order('updated_at', { ascending: false })
    .limit(CONVERSATION_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => ({ id: row.id, title: row.title, updatedAt: row.updated_at }));
};

export const createConversation = async (professorId: number): Promise<Conversation> => {
  const { data, error } = await database
    .from('ai_chat_conversations')
    .insert({ professor_id: professorId })
    .select('id, title, updated_at')
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, title: data.title, updatedAt: data.updated_at };
};

// 404s rather than 403 on a conversation that exists but belongs to someone else - same
// not-found framing every other owned-resource lookup in this codebase uses
const requireOwnedConversation = async (professorId: number, conversationId: number): Promise<void> => {
  const { data, error } = await database.from('ai_chat_conversations').select('id, professor_id').eq('id', conversationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.professor_id !== professorId) throw new HttpError(404, 'Conversation not found');
};

export const getConversationMessages = async (professorId: number, conversationId: number): Promise<ChatHistoryMessage[]> => {
  await requireOwnedConversation(professorId, conversationId);
  const { data, error } = await database
    .from('ai_chat_messages')
    .select('role, content, actions, file_name, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(MESSAGE_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => ({ role: row.role, content: row.content, actions: row.actions, fileName: row.file_name, createdAt: row.created_at }));
};

export const deleteConversation = async (professorId: number, conversationId: number): Promise<void> => {
  await requireOwnedConversation(professorId, conversationId);
  const { error } = await database.from('ai_chat_conversations').delete().eq('id', conversationId);
  if (error) throw new Error(error.message);
};

const autoTitle = (content: string): string => {
  const trimmed = content.trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'New chat';
  return trimmed.length > TITLE_LENGTH ? `${trimmed.slice(0, TITLE_LENGTH)}...` : trimmed;
};

// best-effort, same as lib/notifications.ts's notify: a history row failing to save must never
// break the chat reply that already went back to the professor
export const saveChatMessage = async (
  conversationId: number,
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
    .insert({ conversation_id: conversationId, role, content, actions: actions !== undefined ? JSON.stringify(actions) : null, file_name: fileName ?? null });
  if (error) {
    console.log('Error saving AI chat message:', error.message);
    return;
  };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (role === 'user') {
    // only ever set once - a later message in the same conversation shouldn't rename it
    const { data: existing } = await database.from('ai_chat_conversations').select('title').eq('id', conversationId).maybeSingle();
    if (existing && !existing.title) patch.title = autoTitle(content);
  };
  const { error: convError } = await database.from('ai_chat_conversations').update(patch).eq('id', conversationId);
  if (convError) console.log('Error updating AI conversation:', convError.message);
};
