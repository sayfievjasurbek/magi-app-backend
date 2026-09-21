import express from 'express';
import { protectRoute } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';
import { addMonitoringMedia, listMonitoringMedia, deleteMonitoringMedia } from '../controllers/monitoring.controller.js';


const router = express.Router();

router.use(protectRoute);

// kind is one of panoramic-views, video-recordings, face-snapshots, snapshots
router.post('/attempts/:attemptId/:kind', requireRole('student'), addMonitoringMedia);
router.get('/attempts/:attemptId/:kind', requireRole('professor', 'examiner'), listMonitoringMedia);
router.delete('/:kind/:mediaId', requireRole('professor'), deleteMonitoringMedia);


export default router;
