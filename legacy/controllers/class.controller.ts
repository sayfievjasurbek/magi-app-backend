import { type Request, type Response } from 'express';
import { handleControllerError } from '../../lib/utils.js';
import * as classService from '../services/class.service.js';

//create class
export const createClass = async (req: Request, res: Response) => {
  try {
    const newClass = await classService.createClass(req.user!.id, req.body ?? {});
    return res.status(201).json({ success: true, class: newClass });
  } catch (error: unknown) {
    return handleControllerError(res, error, "createClass controller");
  };
};

//list classes (professor: own classes, student: enrolled classes)
export const listClasses = async (req: Request, res: Response) => {
  try {
    const classes = await classService.listClasses(req.user!.id, req.user!.role);
    return res.status(200).json({ success: true, classes });
  } catch (error: unknown) {
    return handleControllerError(res, error, "listClasses controller");
  };
};

//get class (professor: roster with progress, student: class info)
export const getClass = async (req: Request, res: Response) => {
  try {
    const result = await classService.getClass(req.user!.id, req.user!.role, req.params.id as string);
    return res.status(200).json({ success: true, ...result });
  } catch (error: unknown) {
    return handleControllerError(res, error, "getClass controller");
  };
};

//update class
export const updateClass = async (req: Request, res: Response) => {
  try {
    const updated = await classService.updateClass(req.user!.id, req.params.id as string, req.body ?? {});
    return res.status(200).json({ success: true, class: updated });
  } catch (error: unknown) {
    return handleControllerError(res, error, "updateClass controller");
  };
};

//delete class
export const deleteClass = async (req: Request, res: Response) => {
  try {
    await classService.deleteClass(req.user!.id, req.params.id as string);
    return res.status(200).json({ success: true, message: 'Class deleted successfully' });
  } catch (error: unknown) {
    return handleControllerError(res, error, "deleteClass controller");
  };
};

//enroll student by email
export const addStudent = async (req: Request, res: Response) => {
  try {
    const student = await classService.addStudent(req.user!.id, req.params.id as string, req.body ?? {});
    return res.status(201).json({ success: true, student });
  } catch (error: unknown) {
    return handleControllerError(res, error, "addStudent controller");
  };
};

//remove student from class
export const removeStudent = async (req: Request, res: Response) => {
  try {
    await classService.removeStudent(req.user!.id, req.params.id as string, req.params.studentId as string);
    return res.status(200).json({ success: true, message: 'Student removed from class' });
  } catch (error: unknown) {
    return handleControllerError(res, error, "removeStudent controller");
  };
};
