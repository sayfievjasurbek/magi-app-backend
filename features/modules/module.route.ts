import express from 'express';
import { createModule, listModules, getModule, getModuleRating, getStudentModules, getProfessorModules, getRoster, updateModule, deleteModule, addProfessor, removeProfessor, addStudent, removeStudent } from './module.controller.js';
import { protectRoute } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';


const router = express.Router();

router.use(protectRoute);


//post
router.post("/", requireRole('professor'), createModule);
router.post("/:id/professors", requireRole('professor'), addProfessor);
router.post("/:id/students", requireRole('professor'), addStudent);

//get
router.get("/", requireRole('professor', 'student'), listModules);
router.get("/students/:studentId", requireRole('professor'), getStudentModules);
router.get("/professors/:professorId", requireRole('professor'), getProfessorModules);
router.get("/:id", requireRole('professor', 'student'), getModule);
router.get("/:id/roster", requireRole('professor', 'student'), getRoster);
router.get("/:id/rating", requireRole('professor', 'student'), getModuleRating);

//patch
router.patch("/:id", requireRole('professor'), updateModule);

//delete
router.delete("/:id", requireRole('professor'), deleteModule);
router.delete("/:id/professors/:professorId", requireRole('professor'), removeProfessor);
router.delete("/:id/students/:studentId", requireRole('professor'), removeStudent);


export default router;
