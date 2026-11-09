import { type Request, type Response } from 'express';
import { aiConfigured } from '../../lib/ai.js';
import { handleControllerError } from '../../lib/utils.js';
import { runAssistant } from './assistant.service.js';
import { getChatHistory, saveChatMessage } from './chat-history.service.js';

// the admin panel's "AI online" indicator - whether OPENAI_API_KEY is set, not a live ping
export const getAiStatus = async (req: Request, res: Response) => {
  try {
    return res.status(200).json({ success: true, configured: aiConfigured() });
  } catch (error) {
    return handleControllerError(res, error, "ai controller");
  };
};

// the chat panel's past conversation, so it's there again after closing the panel or reloading
export const getAiHistory = async (req: Request, res: Response) => {
  try {
    const messages = await getChatHistory(req.user!.id);
    return res.status(200).json({ success: true, messages });
  } catch (error) {
    return handleControllerError(res, error, "ai controller");
  };
};

// Magi AI, talking to a professor and acting on their behalf through assistant.service's tools
export const chatWithAssistant = async (req: Request, res: Response) => {
  try {
    if (!aiConfigured()) return res.status(503).json({ success: false, message: 'AI is not configured' });

    const { reply, actions } = await runAssistant(req.user!, req.body);

    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const fileName = typeof req.body?.file?.name === 'string' ? req.body.file.name : null;
    await saveChatMessage(req.user!.id, 'user', message, undefined, fileName);
    await saveChatMessage(req.user!.id, 'assistant', reply, actions);

    return res.status(200).json({ success: true, reply, actions });
  } catch (error) {
    return handleControllerError(res, error, "ai controller");
  };
};
