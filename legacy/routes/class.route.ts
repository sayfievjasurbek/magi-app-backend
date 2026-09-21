import express from 'express';
import { createClass, listClasses, getClass, updateClass, deleteClass, addStudent, removeStudent } from '../controllers/class.controller.js';
import { protectRoute } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';


const router = express.Router();

router.use(protectRoute);


//post
router.post("/", requireRole('professor'), createClass);
router.post("/:id/students", requireRole('professor'), addStudent);

//get
router.get("/", listClasses);
router.get("/:id", getClass);

//patch
router.patch("/:id", requireRole('professor'), updateClass);

//delete
router.delete("/:id", requireRole('professor'), deleteClass);
router.delete("/:id/students/:studentId", requireRole('professor'), removeStudent);



export default router;
