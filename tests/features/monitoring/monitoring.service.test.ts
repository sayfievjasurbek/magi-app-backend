import { describe, it, expect, vi, beforeEach } from 'vitest';

// one chainable fake for the whole builder: every call lands in `calls`, every awaited query takes the next queued result
const { from, calls, results } = vi.hoisted(() => {
  const calls: any[][] = [];
  const results: any[] = [];
  const take = () => (results.length ? results.shift() : { data: null, error: null });
  const chain: any = {
    single: () => Promise.resolve(take()),
    maybeSingle: () => Promise.resolve(take()),
    then: (resolve: any, reject: any) => Promise.resolve(take()).then(resolve, reject),
  };
  for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'order', 'limit']) {
    chain[method] = (...args: any[]) => {
      calls.push([method, ...args]);
      return chain;
    };
  }
  const from = vi.fn((table: string) => {
    calls.push(['from', table]);
    return chain;
  });
  return { from, calls, results };
});

vi.mock('../../../lib/db.js', () => ({ database: { from } }));

import { addMedia, listMedia, deleteMedia } from '../../../features/monitoring/monitoring.service.js';
import { HttpError } from '../../../lib/errors.js';

const queue = (...rows: any[]) => results.push(...rows);
const row = (data: any) => ({ data, error: null });
const none = { data: null, error: null };
const fails = (message: string) => ({ data: null, error: { message } });

const tables = () => calls.filter(([method]) => method === 'from').map(([, table]) => table);
const callsOf = (method: string) => calls.filter(([name]) => name === method);

const rejected = async (promise: Promise<unknown>): Promise<any> => promise.then(() => null, (error) => error);

// an attempt of an exam that runs until 2099: nothing here is ever out of time by the clock
const timing = { session_duration: 3600, session_duration_unit: 'seconds', started_at: null };
const inProgress = row({ id: 7, exam_id: 3, status: 'in_progress', submitted_at: null, ...timing });
const openWindow = row({ scheduled_start: '2099-01-01T00:00:00Z', scheduled_end: '2099-01-01T02:00:00Z' });
const closedWindow = row({ scheduled_start: '2020-01-01T00:00:00Z', scheduled_end: '2020-01-01T02:00:00Z' });
const owner = row({ assignment_id: 7 });
const professor = { id: 9, role: 'professor' } as const;
const examiner = { id: 9, role: 'examiner' } as const;

// the live exam behind the attempt, then the module join: what lib/exam-access.ts reads for a professor
const someoneElsesExam = row({ id: 3, created_by: 4 });
const teaches = [someoneElsesExam, row([{ module_id: 2 }]), row([{ module_id: 2 }])];

beforeEach(() => {
  calls.length = 0;
  results.length = 0;
  from.mockClear();
});

describe('addMedia', () => {
  it('stores the url and links it to the attempt', async () => {
    queue(inProgress, owner, openWindow, row({ id: 21, url: 'https://media.magi.edu/s.png', created_at: 'now' }), none);

    const media = await addMedia('snapshots', '7', 5, 'https://media.magi.edu/s.png');

    expect(media).toEqual({ id: 21, url: 'https://media.magi.edu/s.png', created_at: 'now' });
    expect(tables()).toEqual(['assignments', 'student_assignment', 'exams', 'snapshots', 'assignment_snapshot']);
    expect(callsOf('insert')).toEqual([
      ['insert', { url: 'https://media.magi.edu/s.png' }],
      ['insert', { assignment_id: 7, snapshot_id: 21 }],
    ]);
  });

  it('writes every kind into its own pair of tables', async () => {
    const pairs = [
      ['panoramic-views', 'panoramic_view', 'assignment_panoramic_view', 'panoramic_view_id'],
      ['video-recordings', 'video_recordings', 'assignment_video_recording', 'video_recording_id'],
      ['face-snapshots', 'face_snapshots', 'assignment_face_snapshot', 'face_snapshot_id'],
      ['snapshots', 'snapshots', 'assignment_snapshot', 'snapshot_id'],
    ];

    for (const [kind, table, join, column] of pairs) {
      calls.length = 0;
      queue(inProgress, owner, openWindow, row({ id: 21, url: 'https://x.test/a', created_at: 'now' }), none);

      await addMedia(kind, '7', 5, 'https://x.test/a');

      expect(tables()).toEqual(['assignments', 'student_assignment', 'exams', table, join]);
      expect(callsOf('insert')[1]).toEqual(['insert', { assignment_id: 7, [column]: 21 }]);
    }
  });

  it('trims the url', async () => {
    queue(inProgress, owner, openWindow, row({ id: 21 }), none);

    await addMedia('snapshots', '7', 5, '  https://x.test/a  ');

    expect(callsOf('insert')[0]).toEqual(['insert', { url: 'https://x.test/a' }]);
  });

  it('404s on an unknown kind without touching the database', async () => {
    const error = await rejected(addMedia('webcam', '7', 5, 'https://x.test/a'));

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(404);
    expect(from).not.toHaveBeenCalled();
  });

  it('404s on an attempt id that does not parse', async () => {
    const error = await rejected(addMedia('snapshots', 'abc', 5, 'https://x.test/a'));

    expect(error.status).toBe(404);
    expect(from).not.toHaveBeenCalled();
  });

  it('400s on a missing or malformed url', async () => {
    for (const url of [undefined, '', '   ', 'media.magi.edu/s.png', 'ftp://x.test/a', 'javascript:alert(1)', 42]) {
      const error = await rejected(addMedia('snapshots', '7', 5, url));
      expect(error.status).toBe(400);
    }
    expect(from).not.toHaveBeenCalled();
  });

  it('400s on a url past 2048 characters', async () => {
    const error = await rejected(addMedia('snapshots', '7', 5, `https://x.test/${'a'.repeat(2048)}`));

    expect(error.status).toBe(400);
    expect(error.message).toBe('url must be at most 2048 characters');
  });

  it('404s when the attempt does not exist', async () => {
    queue(none);

    const error = await rejected(addMedia('snapshots', '7', 5, 'https://x.test/a'));

    expect(error.status).toBe(404);
    expect(tables()).toEqual(['assignments']);
  });

  it('404s on an attempt of another student', async () => {
    queue(inProgress, none);

    const error = await rejected(addMedia('snapshots', '7', 5, 'https://x.test/a'));

    expect(error.status).toBe(404);
    expect(error.message).toBe('Attempt not found');
    expect(tables()).toEqual(['assignments', 'student_assignment']);
  });

  it('409s when the attempt is not running', async () => {
    for (const status of ['pending', 'submitted', 'auto_submitted', 'graded']) {
      calls.length = 0;
      queue(row({ id: 7, exam_id: 3, status, submitted_at: null, ...timing }), owner);

      const error = await rejected(addMedia('snapshots', '7', 5, 'https://x.test/a'));

      expect(error.status).toBe(409);
      expect(tables()).toEqual(['assignments', 'student_assignment']);
    }
  });

  it('keeps taking media of an attempt that a cheating incident has flagged', async () => {
    queue(row({ id: 7, exam_id: 3, status: 'flagged', submitted_at: null, ...timing }), owner, openWindow, row({ id: 21 }), none);

    expect(await addMedia('snapshots', '7', 5, 'https://x.test/a')).toEqual({ id: 21 });
  });

  it('409s on a flagged attempt that has been submitted', async () => {
    queue(row({ id: 7, exam_id: 3, status: 'flagged', submitted_at: '2026-09-21T10:00:00Z', ...timing }), owner);

    const error = await rejected(addMedia('snapshots', '7', 5, 'https://x.test/a'));

    expect(error.status).toBe(409);
  });

  it('409s once the time of the attempt is over, even while it still says in_progress', async () => {
    queue(inProgress, owner, closedWindow);

    const error = await rejected(addMedia('snapshots', '7', 5, 'https://x.test/a'));

    expect(error.status).toBe(409);
    expect(error.message).toBe('Time is up: this attempt is over');
    expect(tables()).toEqual(['assignments', 'student_assignment', 'exams']);
    expect(callsOf('insert')).toEqual([]);
  });

  it('409s when the exam behind the attempt is gone', async () => {
    queue(inProgress, owner, none);

    expect((await rejected(addMedia('snapshots', '7', 5, 'https://x.test/a'))).status).toBe(409);
  });

  it('drops the media row again when the link cannot be written', async () => {
    queue(inProgress, owner, openWindow, row({ id: 21, url: 'https://x.test/a' }), fails('link exploded'), none);

    const error = await rejected(addMedia('snapshots', '7', 5, 'https://x.test/a'));

    expect(error).not.toBeInstanceOf(HttpError);
    expect(error.message).toBe('link exploded');
    expect(tables()).toEqual(['assignments', 'student_assignment', 'exams', 'snapshots', 'assignment_snapshot', 'snapshots']);
    expect(callsOf('delete')).toEqual([['delete']]);
    expect(calls.at(-1)).toEqual(['eq', 'id', 21]);
  });

  it('turns an unexpected database error into a plain error', async () => {
    queue(fails('connection reset'));

    const error = await rejected(addMedia('snapshots', '7', 5, 'https://x.test/a'));

    expect(error).not.toBeInstanceOf(HttpError);
    expect(error.message).toBe('connection reset');
  });
});

describe('listMedia', () => {
  it('returns the media of an attempt of a module the professor teaches', async () => {
    queue(
      inProgress,
      ...teaches,
      row([{ snapshot_id: 21 }, { snapshot_id: 20 }]),
      row([{ id: 21, url: 'https://x.test/b', created_at: 'later' }, { id: 20, url: 'https://x.test/a', created_at: 'earlier' }])
    );

    const media = await listMedia('snapshots', '7', professor);

    expect(media).toHaveLength(2);
    expect(media[0].id).toBe(21);
    expect(tables()).toEqual(['assignments', 'exams', 'exam_module', 'module_professor', 'assignment_snapshot', 'snapshots']);
    expect(callsOf('in')).toEqual([['in', 'module_id', [2]], ['in', 'id', [21, 20]]]);
    expect(callsOf('order')).toEqual([
      ['order', 'snapshot_id', { ascending: false }],
      ['order', 'created_at', { ascending: false }],
    ]);
    expect(callsOf('limit')).toEqual([['limit', 1], ['limit', 100], ['limit', 100]]);
    // the attempt, the exam behind it and the media rows are all read live only
    expect(callsOf('is')).toEqual([['is', 'deleted_at', null], ['is', 'deleted_at', null], ['is', 'deleted_at', null]]);
  });

  it('returns the media of an attempt of an exam the professor created without linking it to a module', async () => {
    queue(inProgress, row({ id: 3, created_by: professor.id }), row([{ snapshot_id: 21 }]), row([{ id: 21 }]));

    const media = await listMedia('snapshots', '7', professor);

    expect(media).toHaveLength(1);
    expect(tables()).toEqual(['assignments', 'exams', 'assignment_snapshot', 'snapshots']);
  });

  it('returns the media of an attempt of an exam the examiner is assigned to', async () => {
    queue(inProgress, someoneElsesExam, row({ exam_id: 3 }), row([{ snapshot_id: 21 }]), row([{ id: 21 }]));

    const media = await listMedia('snapshots', '7', examiner);

    expect(media).toHaveLength(1);
    expect(tables()).toEqual(['assignments', 'exams', 'exam_examiner', 'assignment_snapshot', 'snapshots']);
  });

  it('404s for a professor who teaches none of the modules of the exam', async () => {
    queue(inProgress, someoneElsesExam, row([{ module_id: 2 }]), row([]));

    const error = await rejected(listMedia('snapshots', '7', professor));

    expect(error.status).toBe(404);
    expect(tables()).toEqual(['assignments', 'exams', 'exam_module', 'module_professor']);
  });

  it('404s when the exam belongs to no module at all', async () => {
    queue(inProgress, someoneElsesExam, row([]));

    const error = await rejected(listMedia('snapshots', '7', professor));

    expect(error.status).toBe(404);
    expect(tables()).toEqual(['assignments', 'exams', 'exam_module']);
  });

  it('404s for an examiner who is not assigned to the exam', async () => {
    queue(inProgress, someoneElsesExam, none);

    const error = await rejected(listMedia('snapshots', '7', examiner));

    expect(error.status).toBe(404);
  });

  it('404s once the exam itself is soft deleted', async () => {
    queue(inProgress, none);

    const error = await rejected(listMedia('snapshots', '7', professor));

    expect(error.status).toBe(404);
    expect(tables()).toEqual(['assignments', 'exams']);
  });

  it('404s when the attempt does not exist', async () => {
    queue(none);

    const error = await rejected(listMedia('snapshots', '7', professor));

    expect(error.status).toBe(404);
  });

  it('answers with an empty list without reading the media table', async () => {
    queue(inProgress, someoneElsesExam, row({ exam_id: 3 }), row([]));

    expect(await listMedia('snapshots', '7', examiner)).toEqual([]);
    expect(tables()).toEqual(['assignments', 'exams', 'exam_examiner', 'assignment_snapshot']);
  });
});

describe('deleteMedia', () => {
  it('soft deletes the media row and keeps the link', async () => {
    queue(
      row({ assignment_id: 7 }),
      inProgress,
      ...teaches,
      row({ id: 21, url: 'https://x.test/a', deleted_at: 'now', reason: 'blurred' })
    );

    const media = await deleteMedia('snapshots', '21', 9, 'blurred');

    expect(media.reason).toBe('blurred');
    expect(tables()).toEqual(['assignment_snapshot', 'assignments', 'exams', 'exam_module', 'module_professor', 'snapshots']);
    expect(callsOf('delete')).toEqual([]);
    const [[, patch]] = callsOf('update');
    expect(patch.reason).toBe('blurred');
    expect(Number.isNaN(Date.parse(patch.deleted_at))).toBe(false);
  });

  it('400s without a reason', async () => {
    for (const reason of [undefined, '', '  ', 7]) {
      const error = await rejected(deleteMedia('snapshots', '21', 9, reason));
      expect(error.status).toBe(400);
    }
    expect(from).not.toHaveBeenCalled();
  });

  it('400s on a reason past 1000 characters', async () => {
    const error = await rejected(deleteMedia('snapshots', '21', 9, 'x'.repeat(1001)));

    expect(error.status).toBe(400);
  });

  it('404s on an unknown kind or an id that does not parse', async () => {
    expect((await rejected(deleteMedia('webcam', '21', 9, 'blurred'))).status).toBe(404);
    expect((await rejected(deleteMedia('snapshots', '0', 9, 'blurred'))).status).toBe(404);
    expect(from).not.toHaveBeenCalled();
  });

  it('404s when the media belongs to no attempt', async () => {
    queue(none);

    const error = await rejected(deleteMedia('snapshots', '21', 9, 'blurred'));

    expect(error.status).toBe(404);
    expect(error.message).toBe('Media not found');
  });

  it('404s as media when the attempt behind it is gone', async () => {
    queue(row({ assignment_id: 7 }), none);

    const error = await rejected(deleteMedia('snapshots', '21', 9, 'blurred'));

    expect(error.status).toBe(404);
    expect(error.message).toBe('Media not found');
  });

  it('404s for a professor who does not manage the exam', async () => {
    queue(row({ assignment_id: 7 }), inProgress, someoneElsesExam, row([{ module_id: 2 }]), row([]));

    const error = await rejected(deleteMedia('snapshots', '21', 9, 'blurred'));

    expect(error.status).toBe(404);
    expect(callsOf('update')).toEqual([]);
  });

  it('deletes the media of an exam the professor created without linking it to a module', async () => {
    queue(
      row({ assignment_id: 7 }),
      inProgress,
      row({ id: 3, created_by: 9 }),
      row({ id: 21, url: 'https://x.test/a', deleted_at: 'now', reason: 'blurred' })
    );

    expect((await deleteMedia('snapshots', '21', 9, 'blurred')).reason).toBe('blurred');
    expect(tables()).toEqual(['assignment_snapshot', 'assignments', 'exams', 'snapshots']);
  });

  it('404s when the media is already deleted', async () => {
    queue(row({ assignment_id: 7 }), inProgress, ...teaches, none);

    const error = await rejected(deleteMedia('snapshots', '21', 9, 'blurred'));

    expect(error.status).toBe(404);
    expect(callsOf('is')).toContainEqual(['is', 'deleted_at', null]);
  });
});
