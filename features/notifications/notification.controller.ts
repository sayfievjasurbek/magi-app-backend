import { type Request, type Response } from 'express';
import { listNotifications, unreadCount, markRead, markAllRead } from './notification.service.js';
import { handleControllerError } from '../../lib/utils.js';

//the current user's own notifications, newest first
export const listMyNotifications = async (req: Request, res: Response) => {
  try {
    const notifications = await listNotifications(req.user!.id);
    return res.status(200).json({ success: true, notifications });
  } catch (error: unknown) {
    return handleControllerError(res, error, "listMyNotifications controller");
  };
};

//how many are unread - for the bell icon's badge
export const getUnreadCount = async (req: Request, res: Response) => {
  try {
    const count = await unreadCount(req.user!.id);
    return res.status(200).json({ success: true, count });
  } catch (error: unknown) {
    return handleControllerError(res, error, "getUnreadCount controller");
  };
};

//mark one as read (opening it)
export const markNotificationRead = async (req: Request, res: Response) => {
  try {
    const notification = await markRead(req.user!.id, req.params.id as string);
    return res.status(200).json({ success: true, notification });
  } catch (error: unknown) {
    return handleControllerError(res, error, "markNotificationRead controller");
  };
};

//mark every unread one as read
export const markAllNotificationsRead = async (req: Request, res: Response) => {
  try {
    await markAllRead(req.user!.id);
    return res.status(200).json({ success: true, message: 'All notifications marked as read' });
  } catch (error: unknown) {
    return handleControllerError(res, error, "markAllNotificationsRead controller");
  };
};
