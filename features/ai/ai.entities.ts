export type AiChatRole = 'user' | 'assistant';

export type AiChatConversation = {
  id: number;
  professor_id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type AiChatMessage = {
  id: number;
  conversation_id: number;
  role: AiChatRole;
  content: string;
  // the tool calls run for this reply
  actions: unknown[] | null;
  file_name: string | null;
  created_at: string;
  // what the model saw when it differs from what was shown (attached file text)
  model_content: string | null;
};
