import express from 'express';
import { listAttendance, markAttendance } from './attendance.controller.js';
import { protectRoute } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';

const router = express.Router();

router.use(protectRoute);

router.get('/modules/:id', requireRole('professor'), listAttendance);
router.put('/modules/:id/students/:studentId', requireRole('professor'), markAttendance);

export default router;
