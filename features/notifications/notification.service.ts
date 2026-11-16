import { database } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { parseId } from '../../lib/utils.js';
import type { Notification } from './notification.entities.js';

const COLUMNS = 'id, user_id, type, title, body, related_id, read_at, created_at';
const LIST_LIMIT = 100;

export const listNotifications = async (userId: number): Promise<Notification[]> => {
  const { data, error } = await database
    .from('notifications')
    .select(COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT);

  if (error) throw new Error(error.message);
  return (data ?? []) as Notification[];
};

export const unreadCount = async (userId: number): Promise<number> => {
  const { count, error } = await database
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);

  if (error) throw new Error(error.message);
  return count ?? 0;
};

export const markRead = async (userId: number, notificationIdParam: string): Promise<Notification> => {
  const notificationId = parseId(notificationIdParam);
  if (!notificationId) throw new HttpError(404, 'Notification not found');

  const { data, error } = await database
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', userId)
    .select(COLUMNS)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, 'Notification not found');
  return data as Notification;
};

export const markAllRead = async (userId: number): Promise<void> => {
  const { error } = await database
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);

  if (error) throw new Error(error.message);
};
