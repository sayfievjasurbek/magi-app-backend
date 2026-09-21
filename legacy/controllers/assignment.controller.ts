import { type Request, type Response } from 'express';
import { handleControllerError } from '../../lib/utils.js';
import * as assignmentService from '../services/assignment.service.js';

//create assignment
export const createAssignment = async (req: Request, res: Response) => {
  try {
    const assignment = await assignmentService.createAssignment(req.user!.id, req.body ?? {});
    return res.status(201).json({ success: true, assignment });
  } catch (error: unknown) {
    return handleControllerError(res, error, "createAssignment controller");
  };
};

//list assignments (professor: assignments of own classes, student: assignments of enrolled classes)
export const listAssignments = async (req: Request, res: Response) => {
  try {
    const assignments = await assignmentService.listAssignments(req.user!.id, req.user!.role, req.query.classId);
    return res.status(200).json({ success: true, assignments });
  } catch (error: unknown) {
    return handleControllerError(res, error, "listAssignments controller");
  };
};

//get assignment (professor: with stats, student: with own submission status)
export const getAssignment = async (req: Request, res: Response) => {
  try {
    const result = await assignmentService.getAssignment(req.user!.id, req.user!.role, req.params.id as string);
    return res.status(200).json({ success: true, ...result });
  } catch (error: unknown) {
    return handleControllerError(res, error, "getAssignment controller");
  };
};

//update assignment
export const updateAssignment = async (req: Request, res: Response) => {
  try {
    const assignment = await assignmentService.updateAssignment(req.user!.id, req.params.id as string, req.body ?? {});
    return res.status(200).json({ success: true, assignment });
  } catch (error: unknown) {
    return handleControllerError(res, error, "updateAssignment controller");
  };
};

//delete assignment
export const deleteAssignment = async (req: Request, res: Response) => {
  try {
    await assignmentService.deleteAssignment(req.user!.id, req.params.id as string);
    return res.status(200).json({ success: true, message: 'Assignment deleted successfully' });
  } catch (error: unknown) {
    return handleControllerError(res, error, "deleteAssignment controller");
  };
};
