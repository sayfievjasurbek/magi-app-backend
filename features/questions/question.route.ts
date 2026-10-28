import express from 'express';
import { createQuestion, createQuestions, listQuestions, getQuestion, updateQuestion, deleteQuestion } from './question.controller.js';
import { protectRoute } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';


const router = express.Router();

router.use(protectRoute);


//post
router.post("/", requireRole('professor'), createQuestion);
router.post("/batch", requireRole('professor'), createQuestions);

//get
router.get("/", requireRole('professor'), listQuestions);
router.get("/:id", requireRole('professor'), getQuestion);

//patch
router.patch("/:id", requireRole('professor'), updateQuestion);

//delete
router.delete("/:id", requireRole('professor'), deleteQuestion);


export default router;
