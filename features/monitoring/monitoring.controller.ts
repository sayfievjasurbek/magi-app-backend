import { type Request, type Response } from 'express';
import { addMedia, listMedia, deleteMedia } from './monitoring.service.js';
import { handleControllerError } from '../../lib/utils.js';

//add a media url to an attempt (student)
export const addMonitoringMedia = async (req: Request, res: Response) => {
  try {
    const media = await addMedia(req.params.kind as string, req.params.attemptId as string, req.user!.id, req.body?.url);
    return res.status(201).json({ success: true, media });
  } catch (error: unknown) {
    return handleControllerError(res, error, "addMonitoringMedia controller");
  };
};

//list the media of an attempt (professor, examiner)
export const listMonitoringMedia = async (req: Request, res: Response) => {
  try {
    const media = await listMedia(req.params.kind as string, req.params.attemptId as string, req.user!);
    return res.status(200).json({ success: true, media });
  } catch (error: unknown) {
    return handleControllerError(res, error, "listMonitoringMedia controller");
  };
};

//soft delete a media item (professor)
export const deleteMonitoringMedia = async (req: Request, res: Response) => {
  try {
    const media = await deleteMedia(req.params.kind as string, req.params.mediaId as string, req.user!.id, req.body?.reason);
    return res.status(200).json({ success: true, media });
  } catch (error: unknown) {
    return handleControllerError(res, error, "deleteMonitoringMedia controller");
  };
};
