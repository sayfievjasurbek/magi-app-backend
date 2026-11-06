import { type Request, type Response } from 'express';
import { getAttendance, setAttendance } from './attendance.service.js';
import { handleControllerError } from '../../lib/utils.js';

// one day's attendance for every student in the class (professor)
export const listAttendance = async (req: Request, res: Response) => {
  try {
    const attendance = await getAttendance(req.params.id as string, req.user!.id, req.query.date);
    return res.status(200).json({ success: true, attendance });
  } catch (error: unknown) {
    return handleControllerError(res, error, 'listAttendance controller');
  };
};

// marks one student present/absent for one day (professor)
export const markAttendance = async (req: Request, res: Response) => {
  try {
    const entry = await setAttendance(req.params.id as string, req.params.studentId as string, req.user!.id, req.body);
    return res.status(200).json({ success: true, entry });
  } catch (error: unknown) {
    return handleControllerError(res, error, 'markAttendance controller');
  };
};
