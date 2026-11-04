import express from 'express';
import { protectRoute } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/role.middleware.js';
import {
  listExams,
  getExam,
  createExam,
  updateExam,
  deleteExam,
  setExamStatus,
  linkModule,
  unlinkModule,
  addExaminer,
  removeExaminer,
  addStudents,
  removeStudent,
  listExamQuestions,
  attachQuestion,
  updateExamQuestion,
  reorderQuestions,
  detachQuestion,
  listEventCatalog,
  attachEvent,
  detachEvent,
  addPermittedUrl,
  removePermittedUrl,
  addPermittedApp,
  removePermittedApp,
} from './exam.controller.js';


const router = express.Router();

router.use(protectRoute);

// before /:examId, otherwise the catalog is read as an exam id
router.get('/events', requireRole('professor', 'examiner'), listEventCatalog);

router.get('/', listExams);
router.post('/', requireRole('professor'), createExam);
router.get('/:examId', getExam);
router.patch('/:examId', requireRole('professor'), updateExam);
router.delete('/:examId', requireRole('professor'), deleteExam);
router.patch('/:examId/status', requireRole('professor'), setExamStatus);

router.post('/:examId/modules', requireRole('professor'), linkModule);
router.delete('/:examId/modules/:moduleId', requireRole('professor'), unlinkModule);

router.post('/:examId/examiners', requireRole('professor'), addExaminer);
router.delete('/:examId/examiners/:examinerId', requireRole('professor'), removeExaminer);

router.post('/:examId/students', requireRole('professor'), addStudents);
router.delete('/:examId/students/:studentId', requireRole('professor'), removeStudent);

router.get('/:examId/questions', requireRole('professor', 'examiner'), listExamQuestions);
router.post('/:examId/questions', requireRole('professor'), attachQuestion);
router.put('/:examId/questions/order', requireRole('professor'), reorderQuestions);
router.patch('/:examId/questions/:questionId', requireRole('professor'), updateExamQuestion);
router.delete('/:examId/questions/:questionId', requireRole('professor'), detachQuestion);

router.post('/:examId/events', requireRole('professor'), attachEvent);
router.delete('/:examId/events/:eventId', requireRole('professor'), detachEvent);

router.post('/:examId/permitted-urls', requireRole('professor'), addPermittedUrl);
router.delete('/:examId/permitted-urls/:permittedUrlId', requireRole('professor'), removePermittedUrl);

router.post('/:examId/permitted-apps', requireRole('professor'), addPermittedApp);
router.delete('/:examId/permitted-apps/:permittedAppId', requireRole('professor'), removePermittedApp);


export default router;
