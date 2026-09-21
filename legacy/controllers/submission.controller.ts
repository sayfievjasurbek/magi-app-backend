import { type Request, type Response } from 'express';
import { handleControllerError } from '../../lib/utils.js';
import * as submissionService from '../services/submission.service.js';

//submit assignment (student, from the MAGI desktop app)
export const submitAssignment = async (req: Request, res: Response) => {
  try {
    const receipt = await submissionService.submitAssignment(req.user!.id, req.params.id as string, req.body ?? {});
    return res.status(201).json({ success: true, receipt });
  } catch (error: unknown) {
    return handleControllerError(res, error, "submitAssignment controller");
  };
};

//own submission (student)
export const getMySubmission = async (req: Request, res: Response) => {
  try {
    const submission = await submissionService.getMySubmission(req.user!.id, req.params.id as string);
    return res.status(200).json({ success: true, submission });
  } catch (error: unknown) {
    return handleControllerError(res, error, "getMySubmission controller");
  };
};

//submissions roster of an assignment (professor)
export const listSubmissions = async (req: Request, res: Response) => {
  try {
    const submissions = await submissionService.listSubmissions(req.user!.id, req.params.id as string);
    return res.status(200).json({ success: true, submissions });
  } catch (error: unknown) {
    return handleControllerError(res, error, "listSubmissions controller");
  };
};

//full forensic dossier of one student's submission (professor)
export const getSubmission = async (req: Request, res: Response) => {
  try {
    const submission = await submissionService.getSubmission(req.user!.id, req.params.id as string, req.params.studentId as string);
    return res.status(200).json({ success: true, submission });
  } catch (error: unknown) {
    return handleControllerError(res, error, "getSubmission controller");
  };
};

//grade a submission (professor)
export const gradeSubmission = async (req: Request, res: Response) => {
  try {
    const submission = await submissionService.gradeSubmission(req.user!.id, req.params.id as string, req.params.studentId as string, req.body ?? {});
    return res.status(200).json({ success: true, submission });
  } catch (error: unknown) {
    return handleControllerError(res, error, "gradeSubmission controller");
  };
};
