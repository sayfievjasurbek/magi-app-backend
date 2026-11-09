import { type Request, type Response } from 'express';
import { aiConfigured } from '../../lib/ai.js';
import { handleControllerError } from '../../lib/utils.js';
import { runAssistant } from './assistant.service.js';

// the admin panel's "AI online" indicator - whether OPENAI_API_KEY is set, not a live ping
export const getAiStatus = async (req: Request, res: Response) => {
  try {
    return res.status(200).json({ success: true, configured: aiConfigured() });
  } catch (error) {
    return handleControllerError(res, error, "ai controller");
  };
};

// Magi AI, talking to a professor and acting on their behalf through assistant.service's tools
export const chatWithAssistant = async (req: Request, res: Response) => {
  try {
    if (!aiConfigured()) return res.status(503).json({ success: false, message: 'AI is not configured' });

    const { reply, actions } = await runAssistant(req.user!, req.body);
    return res.status(200).json({ success: true, reply, actions });
  } catch (error) {
    return handleControllerError(res, error, "ai controller");
  };
};
