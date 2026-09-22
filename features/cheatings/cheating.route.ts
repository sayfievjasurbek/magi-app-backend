import express from 'express';
import { protectRoute } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import { createCheating, listAttemptCheatings, getCheating, getCheatingSummary, deleteCheating } from './cheating.controller.js';


const router = express.Router();

router.use(protectRoute);

// students report the automatic types on their own attempt, staff records any type
router.post('/attempts/:attemptId', createCheating);
// /summary stays above /:cheatingId, it would match the id route otherwise
router.get('/summary', requireRole('professor', 'examiner'), getCheatingSummary);
router.get('/attempts/:attemptId', requireRole('professor', 'examiner'), listAttemptCheatings);
router.get('/:cheatingId', requireRole('professor', 'examiner'), getCheating);
router.delete('/:cheatingId', requireRole('professor'), deleteCheating);


export default router;
