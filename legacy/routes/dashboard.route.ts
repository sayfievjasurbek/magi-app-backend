import express from 'express';
import { professorDashboard, studentDashboard } from '../controllers/dashboard.controller.js';
import { protectRoute } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';


const router = express.Router();


//get
router.get("/professor", protectRoute, requireRole('professor'), professorDashboard);
router.get("/student", protectRoute, requireRole('student'), studentDashboard);



export default router;
