import express from 'express';
import { protectRoute } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import { aiReviewAttempt, getAttempt, getAttemptsSummary, getExamAttempts, getMyAttempts, gradeAttempt, startAttempt, submitAttempt, syncAnswers } from './attempt.controller.js';


const router = express.Router();

router.use(protectRoute);

// attempts domain (table assignments): a student sitting an exam

router.post('/', requireRole('student'), startAttempt);
router.get('/my', requireRole('student'), getMyAttempts);
router.put('/:id/answers', requireRole('student'), syncAnswers);
router.post('/:id/submit', requireRole('student'), submitAttempt);

// /summary stays above /:id, it would match the id route otherwise
router.get('/summary', requireRole('professor'), getAttemptsSummary);
router.get('/', requireRole('professor', 'examiner'), getExamAttempts);
router.put('/:id/grade', requireRole('professor'), gradeAttempt);
router.post('/:id/ai-review', requireRole('professor'), aiReviewAttempt);

// both sides read one attempt, the service decides how much of it the caller sees
router.get('/:id', requireRole('student', 'professor', 'examiner'), getAttempt);


export default router;
