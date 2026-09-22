import { type Request, type Response } from 'express';
import { handleControllerError, parseId } from '../../lib/utils.js';
import * as attempts from './attempt.service.js';

export const startAttempt = async (req: Request, res: Response) => {
  try {
    const attempt = await attempts.startAttempt(req.user!.id, req.body ?? {});
    return res.status(201).json({ success: true, attempt });
  } catch (error) {
    return handleControllerError(res, error, "attempt controller");
  };
};

export const getMyAttempts = async (req: Request, res: Response) => {
  try {
    const attemptList = await attempts.listMyAttempts(req.user!.id);
    return res.status(200).json({ success: true, attempts: attemptList });
  } catch (error) {
    return handleControllerError(res, error, "attempt controller");
  };
};

export const getExamAttempts = async (req: Request, res: Response) => {
  try {
    const attemptList = await attempts.listExamAttempts(req.user!, req.query);
    return res.status(200).json({ success: true, attempts: attemptList });
  } catch (error) {
    return handleControllerError(res, error, "attempt controller");
  };
};

export const getAttempt = async (req: Request, res: Response) => {
  try {
    const attempt = await attempts.getAttempt(req.user!, parseId(req.params.id));
    return res.status(200).json({ success: true, attempt });
  } catch (error) {
    return handleControllerError(res, error, "attempt controller");
  };
};

export const syncAnswers = async (req: Request, res: Response) => {
  try {
    const synced = await attempts.syncAnswers(req.user!.id, parseId(req.params.id), req.body ?? {});
    return res.status(200).json({ success: true, ...synced });
  } catch (error) {
    return handleControllerError(res, error, "attempt controller");
  };
};

export const submitAttempt = async (req: Request, res: Response) => {
  try {
    const { attempt, message } = await attempts.submitAttempt(req.user!.id, parseId(req.params.id));
    return res.status(200).json({ success: true, attempt, message });
  } catch (error) {
    return handleControllerError(res, error, "attempt controller");
  };
};

export const gradeAttempt = async (req: Request, res: Response) => {
  try {
    const attempt = await attempts.gradeAttempt(req.user!.id, parseId(req.params.id), req.body ?? {});
    return res.status(200).json({ success: true, attempt });
  } catch (error) {
    return handleControllerError(res, error, "attempt controller");
  };
};
