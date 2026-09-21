import express from 'express';
import { createAssignment, listAssignments, getAssignment, updateAssignment, deleteAssignment } from '../controllers/assignment.controller.js';
import { submitAssignment, getMySubmission, listSubmissions, getSubmission, gradeSubmission } from '../controllers/submission.controller.js';
import { protectRoute } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';


const router = express.Router();

router.use(protectRoute);


//post
router.post("/", requireRole('professor'), createAssignment);
router.post("/:id/submissions", requireRole('student'), submitAssignment);

//get
router.get("/", listAssignments);
router.get("/:id", getAssignment);
router.get("/:id/submissions", requireRole('professor'), listSubmissions);
router.get("/:id/submissions/me", requireRole('student'), getMySubmission);
router.get("/:id/submissions/:studentId", requireRole('professor'), getSubmission);

//put
router.put("/:id/submissions/:studentId/grade", requireRole('professor'), gradeSubmission);

//patch
router.patch("/:id", requireRole('professor'), updateAssignment);

//delete
router.delete("/:id", requireRole('professor'), deleteAssignment);



export default router;
