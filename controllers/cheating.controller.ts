import { type Request, type Response } from 'express';
import { createIncident, listIncidents, getIncident, dismissIncident, examSummary } from '../services/cheating.service.js';
import { handleControllerError } from '../lib/utils.js';

//record an incident on an attempt (student for the automatic types, professor and examiner for any)
export const createCheating = async (req: Request, res: Response) => {
  try {
    const cheating = await createIncident(req.params.attemptId as string, req.user!, req.body?.name, req.body?.explanation);
    return res.status(201).json({ success: true, cheating });
  } catch (error: unknown) {
    return handleControllerError(res, error, "createCheating controller");
  };
};

//incidents of an attempt (professor, examiner)
export const listAttemptCheatings = async (req: Request, res: Response) => {
  try {
    const cheatings = await listIncidents(req.params.attemptId as string, req.user!);
    return res.status(200).json({ success: true, cheatings });
  } catch (error: unknown) {
    return handleControllerError(res, error, "listAttemptCheatings controller");
  };
};

//one incident (professor, examiner)
export const getCheating = async (req: Request, res: Response) => {
  try {
    const cheating = await getIncident(req.params.cheatingId as string, req.user!);
    return res.status(200).json({ success: true, cheating });
  } catch (error: unknown) {
    return handleControllerError(res, error, "getCheating controller");
  };
};

//counts per type over a whole exam (professor, examiner)
export const getCheatingSummary = async (req: Request, res: Response) => {
  try {
    const summary = await examSummary(req.query.examId, req.user!);
    return res.status(200).json({ success: true, summary });
  } catch (error: unknown) {
    return handleControllerError(res, error, "getCheatingSummary controller");
  };
};

//dismiss an incident (professor)
export const deleteCheating = async (req: Request, res: Response) => {
  try {
    const cheating = await dismissIncident(req.params.cheatingId as string, req.user!.id, req.body?.reason);
    return res.status(200).json({ success: true, cheating });
  } catch (error: unknown) {
    return handleControllerError(res, error, "deleteCheating controller");
  };
};
