import { type Request, type Response } from 'express';
import { aiConfigured } from '../../lib/ai.js';
import { handleControllerError } from '../../lib/utils.js';

// the admin panel's "AI online" indicator - whether ANTHROPIC_API_KEY is set, not a live ping
export const getAiStatus = async (req: Request, res: Response) => {
  try {
    return res.status(200).json({ success: true, configured: aiConfigured() });
  } catch (error) {
    return handleControllerError(res, error, "ai controller");
  };
};
