import express from 'express';
import { protectRoute } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import { getAiStatus } from './ai.controller.js';

const router = express.Router();

router.use(protectRoute);

router.get('/status', requireRole('professor'), getAiStatus);

export default router;
