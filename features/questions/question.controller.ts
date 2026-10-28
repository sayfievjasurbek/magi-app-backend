import { type Request, type Response } from 'express';
import { handleControllerError } from '../../lib/utils.js';
import * as questionService from './question.service.js';

//create question with its options
export const createQuestion = async (req: Request, res: Response) => {
  try {
    const question = await questionService.createQuestion(req.user!.id, req.body ?? {});
    return res.status(201).json({ success: true, question });
  } catch (error: unknown) {
    return handleControllerError(res, error, "createQuestion controller");
  };
};

//create several questions in one call
export const createQuestions = async (req: Request, res: Response) => {
  try {
    const questions = await questionService.createQuestions(req.user!.id, req.body ?? {});
    return res.status(201).json({ success: true, questions });
  } catch (error: unknown) {
    return handleControllerError(res, error, "createQuestions controller");
  };
};

//list own questions (filters: questionType, search)
export const listQuestions = async (req: Request, res: Response) => {
  try {
    const questions = await questionService.listQuestions(req.user!.id, req.query as Record<string, unknown>);
    return res.status(200).json({ success: true, questions });
  } catch (error: unknown) {
    return handleControllerError(res, error, "listQuestions controller");
  };
};

//get question with its options
export const getQuestion = async (req: Request, res: Response) => {
  try {
    const question = await questionService.getQuestion(req.user!.id, req.params.id as string);
    return res.status(200).json({ success: true, question });
  } catch (error: unknown) {
    return handleControllerError(res, error, "getQuestion controller");
  };
};

//update question, optionally replacing its options
export const updateQuestion = async (req: Request, res: Response) => {
  try {
    const question = await questionService.updateQuestion(req.user!.id, req.params.id as string, req.body ?? {});
    return res.status(200).json({ success: true, question });
  } catch (error: unknown) {
    return handleControllerError(res, error, "updateQuestion controller");
  };
};

//soft delete question
export const deleteQuestion = async (req: Request, res: Response) => {
  try {
    await questionService.deleteQuestion(req.user!.id, req.params.id as string, req.body ?? {});
    return res.status(200).json({ success: true, message: 'Question deleted successfully' });
  } catch (error: unknown) {
    return handleControllerError(res, error, "deleteQuestion controller");
  };
};
