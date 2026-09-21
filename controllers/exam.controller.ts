import { type Request, type Response } from 'express';
import { HttpError } from '../lib/errors.js';
import { handleControllerError, parseId } from '../lib/utils.js';
import * as service from '../services/exam.service.js';

// a path id that does not parse cannot match a row, so it answers like a missing one
const pathId = (value: unknown, name: string) => {
  const id = parseId(value);
  if (!id) throw new HttpError(404, `${name} not found`);
  return id;
};

export const listExams = async (req: Request, res: Response) => {
  try {
    const exams = await service.listExams(req.user!);
    return res.status(200).json({ success: true, exams });
  } catch (error: unknown) {
    return handleControllerError(res, error, "listExams controller");
  };
};

export const getExam = async (req: Request, res: Response) => {
  try {
    const exam = await service.getExam(req.user!, pathId(req.params.examId, 'Exam'));
    return res.status(200).json({ success: true, exam });
  } catch (error: unknown) {
    return handleControllerError(res, error, "getExam controller");
  };
};

export const createExam = async (req: Request, res: Response) => {
  try {
    const exam = await service.createExam(req.user!.id, req.body);
    return res.status(201).json({ success: true, exam });
  } catch (error: unknown) {
    return handleControllerError(res, error, "createExam controller");
  };
};

export const updateExam = async (req: Request, res: Response) => {
  try {
    const exam = await service.updateExam(req.user!.id, pathId(req.params.examId, 'Exam'), req.body);
    return res.status(200).json({ success: true, exam });
  } catch (error: unknown) {
    return handleControllerError(res, error, "updateExam controller");
  };
};

export const deleteExam = async (req: Request, res: Response) => {
  try {
    await service.deleteExam(req.user!.id, pathId(req.params.examId, 'Exam'), req.body);
    return res.status(200).json({ success: true, message: "Exam deleted" });
  } catch (error: unknown) {
    return handleControllerError(res, error, "deleteExam controller");
  };
};

export const setExamStatus = async (req: Request, res: Response) => {
  try {
    const exam = await service.setExamStatus(req.user!.id, pathId(req.params.examId, 'Exam'), req.body);
    return res.status(200).json({ success: true, exam });
  } catch (error: unknown) {
    return handleControllerError(res, error, "setExamStatus controller");
  };
};

export const linkModule = async (req: Request, res: Response) => {
  try {
    const link = await service.linkModule(req.user!.id, pathId(req.params.examId, 'Exam'), req.body);
    return res.status(201).json({ success: true, link });
  } catch (error: unknown) {
    return handleControllerError(res, error, "linkModule controller");
  };
};

export const unlinkModule = async (req: Request, res: Response) => {
  try {
    await service.unlinkModule(req.user!.id, pathId(req.params.examId, 'Exam'), pathId(req.params.moduleId, 'Module'));
    return res.status(200).json({ success: true, message: "Module unlinked" });
  } catch (error: unknown) {
    return handleControllerError(res, error, "unlinkModule controller");
  };
};

export const addExaminer = async (req: Request, res: Response) => {
  try {
    const link = await service.addExaminer(req.user!.id, pathId(req.params.examId, 'Exam'), req.body);
    return res.status(201).json({ success: true, link });
  } catch (error: unknown) {
    return handleControllerError(res, error, "addExaminer controller");
  };
};

export const removeExaminer = async (req: Request, res: Response) => {
  try {
    await service.removeExaminer(req.user!.id, pathId(req.params.examId, 'Exam'), pathId(req.params.examinerId, 'Examiner'));
    return res.status(200).json({ success: true, message: "Examiner removed" });
  } catch (error: unknown) {
    return handleControllerError(res, error, "removeExaminer controller");
  };
};

export const addStudents = async (req: Request, res: Response) => {
  try {
    const { added } = await service.addStudents(req.user!.id, pathId(req.params.examId, 'Exam'), req.body);
    return res.status(201).json({ success: true, added });
  } catch (error: unknown) {
    return handleControllerError(res, error, "addStudents controller");
  };
};

export const removeStudent = async (req: Request, res: Response) => {
  try {
    await service.removeStudent(req.user!.id, pathId(req.params.examId, 'Exam'), pathId(req.params.studentId, 'Student'));
    return res.status(200).json({ success: true, message: "Student removed" });
  } catch (error: unknown) {
    return handleControllerError(res, error, "removeStudent controller");
  };
};

export const listExamQuestions = async (req: Request, res: Response) => {
  try {
    const { questions, marks_total, max_marks } = await service.listExamQuestions(req.user!, pathId(req.params.examId, 'Exam'));
    return res.status(200).json({ success: true, questions, marks_total, max_marks });
  } catch (error: unknown) {
    return handleControllerError(res, error, "listExamQuestions controller");
  };
};

export const attachQuestion = async (req: Request, res: Response) => {
  try {
    const question = await service.attachQuestion(req.user!.id, pathId(req.params.examId, 'Exam'), req.body);
    return res.status(201).json({ success: true, question });
  } catch (error: unknown) {
    return handleControllerError(res, error, "attachQuestion controller");
  };
};

export const updateExamQuestion = async (req: Request, res: Response) => {
  try {
    const question = await service.updateExamQuestion(
      req.user!.id,
      pathId(req.params.examId, 'Exam'),
      pathId(req.params.questionId, 'Question'),
      req.body
    );
    return res.status(200).json({ success: true, question });
  } catch (error: unknown) {
    return handleControllerError(res, error, "updateExamQuestion controller");
  };
};

export const reorderQuestions = async (req: Request, res: Response) => {
  try {
    const questions = await service.reorderQuestions(req.user!.id, pathId(req.params.examId, 'Exam'), req.body);
    return res.status(200).json({ success: true, questions });
  } catch (error: unknown) {
    return handleControllerError(res, error, "reorderQuestions controller");
  };
};

export const detachQuestion = async (req: Request, res: Response) => {
  try {
    await service.detachQuestion(req.user!.id, pathId(req.params.examId, 'Exam'), pathId(req.params.questionId, 'Question'));
    return res.status(200).json({ success: true, message: "Question detached" });
  } catch (error: unknown) {
    return handleControllerError(res, error, "detachQuestion controller");
  };
};

export const listEventCatalog = async (req: Request, res: Response) => {
  try {
    const events = await service.listEventCatalog();
    return res.status(200).json({ success: true, events });
  } catch (error: unknown) {
    return handleControllerError(res, error, "listEventCatalog controller");
  };
};

export const attachEvent = async (req: Request, res: Response) => {
  try {
    const event = await service.attachEvent(req.user!.id, pathId(req.params.examId, 'Exam'), req.body);
    return res.status(201).json({ success: true, event });
  } catch (error: unknown) {
    return handleControllerError(res, error, "attachEvent controller");
  };
};

export const detachEvent = async (req: Request, res: Response) => {
  try {
    await service.detachEvent(req.user!.id, pathId(req.params.examId, 'Exam'), pathId(req.params.eventId, 'Event'));
    return res.status(200).json({ success: true, message: "Event detached" });
  } catch (error: unknown) {
    return handleControllerError(res, error, "detachEvent controller");
  };
};

export const addPermittedUrl = async (req: Request, res: Response) => {
  try {
    const permitted_url = await service.addPermittedUrl(req.user!.id, pathId(req.params.examId, 'Exam'), req.body);
    return res.status(201).json({ success: true, permitted_url });
  } catch (error: unknown) {
    return handleControllerError(res, error, "addPermittedUrl controller");
  };
};

export const removePermittedUrl = async (req: Request, res: Response) => {
  try {
    await service.removePermittedUrl(
      req.user!.id,
      pathId(req.params.examId, 'Exam'),
      pathId(req.params.permittedUrlId, 'Permitted url')
    );
    return res.status(200).json({ success: true, message: "Permitted url removed" });
  } catch (error: unknown) {
    return handleControllerError(res, error, "removePermittedUrl controller");
  };
};
