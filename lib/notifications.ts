import { database } from './db.js';

export type NotificationType = 'exam_assigned' | 'module_enrolled' | 'exam_graded' | 'password_changed' | 'exam_updated' | 'retake_allowed';

// best-effort: a notification failing to write must never break the action that triggered it
export const notify = async (userId: number, type: NotificationType, title: string, body: string | null, relatedId?: number) => {
  const { error } = await database.from('notifications').insert({ user_id: userId, type, title, body, related_id: relatedId ?? null });
  if (error) console.log('Error creating notification:', error.message);
};

export const notifyMany = async (userIds: number[], type: NotificationType, title: string, body: string | null, relatedId?: number) => {
  if (!userIds.length) return;
  const { error } = await database
    .from('notifications')
    .insert(userIds.map((user_id) => ({ user_id, type, title, body, related_id: relatedId ?? null })));
  if (error) console.log('Error creating notifications:', error.message);
};
