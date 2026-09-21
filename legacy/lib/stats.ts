import { database } from '../../lib/db.js';

export { average, fullName } from '../../lib/stats.js';

export const countEnrollments = async (classIds: string[]): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {};
  if (!classIds.length) return counts;

  const { data, error } = await database
    .from('enrollments')
    .select('class_id')
    .in('class_id', classIds);

  if (error) throw new Error(error.message);
  for (const row of data ?? []) counts[row.class_id] = (counts[row.class_id] ?? 0) + 1;
  return counts;
};

// not_started -> pending_review -> graded, or lapsed when the deadline passed without a submission
export const taskStatus = (submission: { status: string } | undefined, dueDate: string) => {
  if (submission) return submission.status;
  return new Date(dueDate) < new Date() ? 'lapsed' : 'not_started';
};

export const taskPriority = (status: string, dueDate: string) => {
  if (status !== 'not_started') return 'low';
  const daysLeft = (new Date(dueDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  if (daysLeft <= 3) return 'high';
  if (daysLeft <= 7) return 'medium';
  return 'low';
};
