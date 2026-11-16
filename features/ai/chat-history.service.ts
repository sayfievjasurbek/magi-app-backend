import { database } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { getClient, MODEL } from '../../lib/ai.js';

export type Conversation = { id: number; title: string | null; updatedAt: string };

export type ChatHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
  // null = same as content
  modelContent: string | null;
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

const requireOwnedConversation = async (professorId: number, conversationId: number): Promise<void> => {
  const { data, error } = await database.from('ai_chat_conversations').select('id, professor_id').eq('id', conversationId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.professor_id !== professorId) throw new HttpError(404, 'Conversation not found');
};

export const getConversationMessages = async (professorId: number, conversationId: number): Promise<ChatHistoryMessage[]> => {
  await requireOwnedConversation(professorId, conversationId);
  const { data, error } = await database
    .from('ai_chat_messages')
    .select('role, content, model_content, actions, file_name, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(MESSAGE_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => ({
    role: row.role,
    content: row.content,
    modelContent: row.model_content,
    actions: row.actions,
    fileName: row.file_name,
    createdAt: row.created_at,
  }));
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

// replaces the truncated title with a generated one, fine if it fails
const generateConversationTitle = async (conversationId: number, firstMessage: string): Promise<void> => {
  try {
    const openai = getClient();
    if (!openai) return;
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content:
            "Summarize the user's message into a short chat title (3-6 words), in the same language " +
            'they wrote in. Reply with the title text only - no quotes, no punctuation at the end, nothing else.',
        },
        { role: 'user', content: firstMessage },
      ],
      max_tokens: 20,
    });
    const title = completion.choices[0]?.message?.content?.trim();
    if (!title) return;

    const { error } = await database.from('ai_chat_conversations').update({ title }).eq('id', conversationId);
    if (error) console.log('Error saving AI-generated conversation title:', error.message);
  } catch (error) {
    console.log('Error generating conversation title:', error instanceof Error ? error.message : error);
  };
};

// don't break the reply over this
export const saveChatMessage = async (
  conversationId: number,
  role: 'user' | 'assistant',
  content: string,
  actions?: unknown,
  fileName?: string | null,
  modelContent?: string | null,
): Promise<void> => {
  // jsonb needs the string, pg would send an array literal
  const { error } = await database
    .from('ai_chat_messages')
    .insert({
      conversation_id: conversationId,
      role,
      content,
      model_content: modelContent ?? null,
      actions: actions !== undefined ? JSON.stringify(actions) : null,
      file_name: fileName ?? null,
    });
  if (error) {
    console.log('Error saving AI chat message:', error.message);
    return;
  };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let needsGeneratedTitle = false;
  if (role === 'user') {
    // only ever set once - a later message in the same conversation shouldn't rename it
    const { data: existing } = await database.from('ai_chat_conversations').select('title').eq('id', conversationId).maybeSingle();
    if (existing && !existing.title) {
      patch.title = autoTitle(content);
      needsGeneratedTitle = Boolean(content.trim());
    };
  };
  const { error: convError } = await database.from('ai_chat_conversations').update(patch).eq('id', conversationId);
  if (convError) console.log('Error updating AI conversation:', convError.message);

  if (needsGeneratedTitle) void generateConversationTitle(conversationId, content);
};
