import { type Request, type Response } from 'express';
import { aiConfigured } from '../../lib/ai.js';
import { handleControllerError } from '../../lib/utils.js';
import { HttpError } from '../../lib/errors.js';
import { runAssistant } from './assistant.service.js';
import { listConversations, createConversation, getConversationMessages, deleteConversation, saveChatMessage } from './chat-history.service.js';

// the admin panel's "AI online" indicator - whether OPENAI_API_KEY is set, not a live ping
export const getAiStatus = async (req: Request, res: Response) => {
  try {
    return res.status(200).json({ success: true, configured: aiConfigured() });
  } catch (error) {
    return handleControllerError(res, error, "ai controller");
  };
};

// the chat panel's sidebar - every past conversation this professor has had with Magi AI
export const getAiConversations = async (req: Request, res: Response) => {
  try {
    const conversations = await listConversations(req.user!.id);
    return res.status(200).json({ success: true, conversations });
  } catch (error) {
    return handleControllerError(res, error, "ai controller");
  };
};

export const getAiConversationMessages = async (req: Request, res: Response) => {
  try {
    const conversationId = Number(req.params.id);
    if (!Number.isInteger(conversationId)) return res.status(400).json({ success: false, message: 'Invalid conversation id' });

    const messages = await getConversationMessages(req.user!.id, conversationId);
    return res.status(200).json({ success: true, messages });
  } catch (error) {
    return handleControllerError(res, error, "ai controller");
  };
};

export const removeAiConversation = async (req: Request, res: Response) => {
  try {
    const conversationId = Number(req.params.id);
    if (!Number.isInteger(conversationId)) return res.status(400).json({ success: false, message: 'Invalid conversation id' });

    await deleteConversation(req.user!.id, conversationId);
    return res.status(200).json({ success: true, message: 'Conversation deleted' });
  } catch (error) {
    return handleControllerError(res, error, "ai controller");
  };
};

type ResolvedConversation = { conversationId: number | null; history: { role: 'user' | 'assistant'; content: string }[] };

// a bad/unowned conversationId (HttpError) is the professor's own mistake and should surface as
// one - but conversation persistence itself being unavailable (the table not migrated yet, a
// transient DB error) must not take Magi AI down with it; it falls back to an unsaved exchange
// instead, the same way grading/attendance already treat their own notification writes as
// best-effort (see lib/notifications.ts). clientHistory is that fallback's memory: once
// persistence has failed once, conversationId stays null for the rest of the browser session, so
// without it every later turn would look like a brand new conversation - the client's own
// locally-tracked messages are the only thing left that remembers what was actually said. When
// persistence IS working, this is never touched - the DB stays the only source of truth then.
export const resolveConversation = async (
  professorId: number,
  requestedId: unknown,
  clientHistory: unknown,
): Promise<ResolvedConversation> => {
  try {
    if (requestedId === undefined || requestedId === null) {
      const conversation = await createConversation(professorId);
      return { conversationId: conversation.id, history: [] };
    };
    if (!Number.isInteger(requestedId)) throw new HttpError(400, 'Invalid conversation id');
    const messages = await getConversationMessages(professorId, requestedId as number); // 404s if not owned
    return { conversationId: requestedId as number, history: messages.map((m) => ({ role: m.role, content: m.content })) };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.log('Error resolving AI conversation, continuing without persistence:', error instanceof Error ? error.message : error);
    return { conversationId: null, history: (clientHistory ?? []) as ResolvedConversation['history'] };
  };
};

// Magi AI, talking to a professor and acting on their behalf through assistant.service's tools.
// conversationId is optional - omitting it (a "new chat") starts one; the DB is the source of
// truth for that conversation's history from here on, not whatever the client happens to send.
export const chatWithAssistant = async (req: Request, res: Response) => {
  try {
    if (!aiConfigured()) return res.status(503).json({ success: false, message: 'AI is not configured' });

    const { conversationId, history } = await resolveConversation(req.user!.id, req.body?.conversationId, req.body?.history);

    const { reply, actions } = await runAssistant(req.user!, { message: req.body?.message, history, file: req.body?.file });

    if (conversationId !== null) {
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      const fileName = typeof req.body?.file?.name === 'string' ? req.body.file.name : null;
      await saveChatMessage(conversationId, 'user', message, undefined, fileName);
      await saveChatMessage(conversationId, 'assistant', reply, actions);
    };

    return res.status(200).json({ success: true, reply, actions, conversationId });
  } catch (error) {
    return handleControllerError(res, error, "ai controller");
  };
};
