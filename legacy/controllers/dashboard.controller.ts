import { type Request, type Response } from 'express';
import { handleControllerError } from '../../lib/utils.js';
import * as dashboardService from '../services/dashboard.service.js';

//professor dashboard
export const professorDashboard = async (req: Request, res: Response) => {
  try {
    const dashboard = await dashboardService.professorDashboard(req.user!.id);
    return res.status(200).json({ success: true, ...dashboard });
  } catch (error: unknown) {
    return handleControllerError(res, error, "professorDashboard controller");
  };
};

//student dashboard
export const studentDashboard = async (req: Request, res: Response) => {
  try {
    const dashboard = await dashboardService.studentDashboard(req.user!.id);
    return res.status(200).json({ success: true, ...dashboard });
  } catch (error: unknown) {
    return handleControllerError(res, error, "studentDashboard controller");
  };
};
