import express from 'express';
import { protectRoute } from '../../middleware/auth.middleware.js';
import { listMyNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead } from './notification.controller.js';

const router = express.Router();

router.use(protectRoute);

// /unread-count stays above /:id, it would match the id route otherwise
router.get('/unread-count', getUnreadCount);
router.get('/', listMyNotifications);
router.patch('/read-all', markAllNotificationsRead);
router.patch('/:id/read', markNotificationRead);

export default router;
