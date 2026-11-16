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
    // modelContent is internal
    const publicMessages = messages.map(({ role, content, actions, fileName, createdAt }) => ({ role, content, actions, fileName, createdAt }));
    return res.status(200).json({ success: true, messages: publicMessages });
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

// a bad conversationId is a 4xx, but if saving history itself fails just carry on unsaved
// with the client's own history
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
    return { conversationId: requestedId as number, history: messages.map((m) => ({ role: m.role, content: m.modelContent ?? m.content })) };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.log('Error resolving AI conversation, continuing without persistence:', error instanceof Error ? error.message : error);
    return { conversationId: null, history: (clientHistory ?? []) as ResolvedConversation['history'] };
  };
};

export const chatWithAssistant = async (req: Request, res: Response) => {
  try {
    if (!aiConfigured()) return res.status(503).json({ success: false, message: 'AI is not configured' });

    const { conversationId, history } = await resolveConversation(req.user!.id, req.body?.conversationId, req.body?.history);

    const { reply, actions, modelContent, suggestions } = await runAssistant(req.user!, { message: req.body?.message, history, file: req.body?.file });

    if (conversationId !== null) {
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      const fileName = typeof req.body?.file?.name === 'string' ? req.body.file.name : null;
      await saveChatMessage(conversationId, 'user', message, undefined, fileName, modelContent);
      await saveChatMessage(conversationId, 'assistant', reply, actions);
    };

    return res.status(200).json({ success: true, reply, actions, conversationId, suggestions });
  } catch (error) {
    return handleControllerError(res, error, "ai controller");
  };
};
