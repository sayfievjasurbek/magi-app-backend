import { type Request, type Response } from 'express';
import { aiConfigured } from '../../lib/ai.js';
import { handleControllerError } from '../../lib/utils.js';
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

// Magi AI, talking to a professor and acting on their behalf through assistant.service's tools.
// conversationId is optional - omitting it (a "new chat") starts one; the DB is the source of
// truth for that conversation's history from here on, not whatever the client happens to send.
export const chatWithAssistant = async (req: Request, res: Response) => {
  try {
    if (!aiConfigured()) return res.status(503).json({ success: false, message: 'AI is not configured' });

    const { conversationId: requestedId } = req.body ?? {};
    let conversationId: number;
    let history: { role: 'user' | 'assistant'; content: string }[];
    if (requestedId === undefined || requestedId === null) {
      conversationId = (await createConversation(req.user!.id)).id;
      history = [];
    } else {
      if (!Number.isInteger(requestedId)) return res.status(400).json({ success: false, message: 'Invalid conversation id' });
      conversationId = requestedId;
      const messages = await getConversationMessages(req.user!.id, conversationId); // 404s if not owned
      history = messages.map((m) => ({ role: m.role, content: m.content }));
    };

    const { reply, actions } = await runAssistant(req.user!, { message: req.body?.message, history, file: req.body?.file });

    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const fileName = typeof req.body?.file?.name === 'string' ? req.body.file.name : null;
    await saveChatMessage(conversationId, 'user', message, undefined, fileName);
    await saveChatMessage(conversationId, 'assistant', reply, actions);

    return res.status(200).json({ success: true, reply, actions, conversationId });
  } catch (error) {
    return handleControllerError(res, error, "ai controller");
  };
};
