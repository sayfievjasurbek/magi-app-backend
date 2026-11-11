import express from 'express';
import { protectRoute } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import { getAiStatus, chatWithAssistant, getAiConversations, getAiConversationMessages, removeAiConversation } from './ai.controller.js';

const router = express.Router();

router.use(protectRoute);

router.get('/status', requireRole('professor'), getAiStatus);
router.get('/conversations', requireRole('professor'), getAiConversations);
router.get('/conversations/:id/messages', requireRole('professor'), getAiConversationMessages);
router.delete('/conversations/:id', requireRole('professor'), removeAiConversation);
router.post('/chat', requireRole('professor'), chatWithAssistant);

export default router;
