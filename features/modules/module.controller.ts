import { type Request, type Response } from 'express';
import { handleControllerError } from '../../lib/utils.js';
import * as moduleService from './module.service.js';

//create module (the creator manages it)
export const createModule = async (req: Request, res: Response) => {
  try {
    const newModule = await moduleService.createModule(req.user!.id, req.body ?? {});
    return res.status(201).json({ success: true, module: newModule });
  } catch (error: unknown) {
    return handleControllerError(res, error, "createModule controller");
  };
};

//list modules (professor: managed, student: enrolled)
export const listModules = async (req: Request, res: Response) => {
  try {
    const modules = await moduleService.listModules(req.user!.id, req.user!.role);
    return res.status(200).json({ success: true, modules });
  } catch (error: unknown) {
    return handleControllerError(res, error, "listModules controller");
  };
};

//get module
export const getModule = async (req: Request, res: Response) => {
  try {
    const found = await moduleService.getModule(req.user!.id, req.user!.role, req.params.id as string);
    return res.status(200).json({ success: true, module: found });
  } catch (error: unknown) {
    return handleControllerError(res, error, "getModule controller");
  };
};

//professors and students of the module
export const getRoster = async (req: Request, res: Response) => {
  try {
    const roster = await moduleService.getRoster(req.user!.id, req.params.id as string);
    return res.status(200).json({ success: true, ...roster });
  } catch (error: unknown) {
    return handleControllerError(res, error, "getRoster controller");
  };
};

//rename module
export const updateModule = async (req: Request, res: Response) => {
  try {
    const updated = await moduleService.updateModule(req.user!.id, req.params.id as string, req.body ?? {});
    return res.status(200).json({ success: true, module: updated });
  } catch (error: unknown) {
    return handleControllerError(res, error, "updateModule controller");
  };
};

//soft delete module
export const deleteModule = async (req: Request, res: Response) => {
  try {
    await moduleService.deleteModule(req.user!.id, req.params.id as string, req.body ?? {});
    return res.status(200).json({ success: true, message: 'Module deleted successfully' });
  } catch (error: unknown) {
    return handleControllerError(res, error, "deleteModule controller");
  };
};

//add co-professor by email or id
export const addProfessor = async (req: Request, res: Response) => {
  try {
    const professor = await moduleService.addProfessor(req.user!.id, req.params.id as string, req.body ?? {});
    return res.status(201).json({ success: true, professor });
  } catch (error: unknown) {
    return handleControllerError(res, error, "addProfessor controller");
  };
};

//remove co-professor
export const removeProfessor = async (req: Request, res: Response) => {
  try {
    await moduleService.removeProfessor(req.user!.id, req.params.id as string, req.params.professorId as string);
    return res.status(200).json({ success: true, message: 'Professor removed from module' });
  } catch (error: unknown) {
    return handleControllerError(res, error, "removeProfessor controller");
  };
};

//enroll student by email or id
export const addStudent = async (req: Request, res: Response) => {
  try {
    const student = await moduleService.addStudent(req.user!.id, req.params.id as string, req.body ?? {});
    return res.status(201).json({ success: true, student });
  } catch (error: unknown) {
    return handleControllerError(res, error, "addStudent controller");
  };
};

//remove student
export const removeStudent = async (req: Request, res: Response) => {
  try {
    await moduleService.removeStudent(req.user!.id, req.params.id as string, req.params.studentId as string);
    return res.status(200).json({ success: true, message: 'Student removed from module' });
  } catch (error: unknown) {
    return handleControllerError(res, error, "removeStudent controller");
  };
};
