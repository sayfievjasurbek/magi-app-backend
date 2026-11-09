import express from 'express';
import { protectRoute } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import { getAiStatus, chatWithAssistant } from './ai.controller.js';

const router = express.Router();

router.use(protectRoute);

router.get('/status', requireRole('professor'), getAiStatus);
router.post('/chat', requireRole('professor'), chatWithAssistant);

export default router;
