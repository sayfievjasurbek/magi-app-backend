// Notifications domain: one type per table it owns, field for field from migrations/016_notifications.sql.

import type { NotificationType } from '../../lib/notifications.js';

export type Notification = {
  id: number;
  user_id: number;
  type: NotificationType;
  title: string;
  body: string | null;
  related_id: number | null;
  read_at: string | null;
  created_at: string;
};
