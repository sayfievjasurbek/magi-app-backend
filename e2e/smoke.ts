// e2e smoke test against the real db - `npm run e2e`, cleans up after itself
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { database } from '../lib/db.js';

const PORT = 8011;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = randomBytes(3).toString('hex');
const BACKEND = fileURLToPath(new URL('..', import.meta.url));

type Res = { status: number; body: any; cookies: string[] };

const results: { name: string; ok: boolean; detail?: string }[] = [];
const evidence: string[] = [];
const serverLog: string[] = [];
const leaks: string[] = [];

const check = (name: string, ok: boolean, detail?: unknown) => {
  results.push({ name, ok, detail: ok ? undefined : String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` :: ${detail}`}`);
  return ok;
};
const note = (line: string) => {
  evidence.push(line);
  console.log(`NOTE ${line}`);
};
const status = (name: string, res: Res, expected: number) =>
  check(`${name} -> ${expected}`, res.status === expected, `got ${res.status} ${JSON.stringify(res.body)}`);
const must = <T>(value: T | null | undefined, what: string): T => {
  if (value === null || value === undefined) throw new Error(`cannot go on: ${what}`);
  return value;
};

class Client {
  jar = new Map<string, string>();
  seen = new Set<string>();
  constructor(public label: string) {}

  async call(method: string, path: string, body?: unknown): Promise<Res> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    const cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ');
    if (cookie) headers.cookie = cookie;

    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const cookies = res.headers.getSetCookie();
    for (const line of cookies) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((attr) => /^\s*expires=/i.test(attr) && Date.parse(attr.split('=')[1]) < Date.now());
      if (!value || expired) this.jar.delete(name);
      else {
        this.jar.set(name, value);
        if (name === 'jwt') this.seen.add(value);
      }
    }
    const text = await res.text();
    if (text.includes('"password"') || /eyJ[\w-]{10,}\./.test(text) || (this.label.startsWith('stu') && text.includes('is_correct'))) leaks.push(`${method} ${path} as ${this.label}`);
    let json: any = text;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    return { status: res.status, body: json, cookies };
  }
  get = (path: string) => this.call('GET', path);
  post = (path: string, body: unknown = {}) => this.call('POST', path, body);
  put = (path: string, body: unknown = {}) => this.call('PUT', path, body);
  patch = (path: string, body: unknown = {}) => this.call('PATCH', path, body);
  del = (path: string, body?: unknown) => this.call('DELETE', path, body);
}

// what has to be removed again; cleanup also sweeps by owner so a failed run does not leave rows behind
const track = {
  users: [] as number[],
  modules: [] as number[],
  questions: [] as number[],
  exams: [] as number[],
  permittedUrls: [] as number[],
  cheatings: [] as number[],
  media: { 'panoramic-views': [], 'video-recordings': [], 'face-snapshots': [], snapshots: [] } as Record<string, number[]>,
  jwts: new Set<string>(),
};

const MEDIA = {
  'panoramic-views': { table: 'panoramic_view', join: 'assignment_panoramic_view', column: 'panoramic_view_id' },
  'video-recordings': { table: 'video_recordings', join: 'assignment_video_recording', column: 'video_recording_id' },
  'face-snapshots': { table: 'face_snapshots', join: 'assignment_face_snapshot', column: 'face_snapshot_id' },
  snapshots: { table: 'snapshots', join: 'assignment_snapshot', column: 'snapshot_id' },
} as const;

let server: ChildProcess | null = null;

const startServer = () =>
  new Promise<void>((resolve, reject) => {
    server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
      cwd: BACKEND,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => reject(new Error('server did not start in 60s')), 60000);
    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      serverLog.push(...text.split('\n').filter(Boolean));
      if (text.includes('The server running')) {
        clearTimeout(timer);
        resolve();
      }
    };
    server.stdout!.on('data', onData);
    server.stderr!.on('data', onData);
    server.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited (${code}) ${serverLog.slice(-5).join(' | ')}`));
    });
  });

const stopServer = () =>
  new Promise<void>((resolve) => {
    if (!server || server.exitCode !== null) return resolve();
    server.removeAllListeners('exit');
    server.on('exit', () => resolve());
    server.kill('SIGTERM');
    setTimeout(() => {
      server?.kill('SIGKILL');
      resolve();
    }, 5000);
  });

const seedUser = async (role: 'professor' | 'examiner' | 'student', tag: string) => {
  const password = randomBytes(9).toString('base64url');
  const email = `e2e-${RUN}-${tag}@example.test`;
  const { data, error } = await database
    .from('users')
    .insert({ first_name: `E2E ${tag}`, last_name: RUN, email, password: await bcrypt.hash(password, 4), is_verified: true, active_status: 'active' })
    .select('id')
    .single();
  if (error) throw new Error(`seed ${tag}: ${error.message}`);
  track.users.push(data.id);

  const { error: roleError } = await database.from(`${role}s`).insert({ user_id: data.id });
  if (roleError) throw new Error(`seed role ${tag}: ${roleError.message}`);
  return { id: data.id as number, email, password, client: new Client(tag) };
};

const login = async (user: { email: string; password: string; client: Client }) => {
  const res = await user.client.post('/api/auth/login', { email: user.email, password: user.password });
  for (const jwt of user.client.seen) track.jwts.add(jwt);
  return res;
};

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const MIN = 60 * 1000;
const hasKey = (value: unknown, key: string): boolean => JSON.stringify(value).includes(`"${key}"`);
const sorted = (values: number[]) => [...values].sort((a, b) => a - b);

const cleanup = async () => {
  const errors: string[] = [];
  const rows = async (query: PromiseLike<{ data: any; error: { message: string } | null }>, label: string): Promise<any[]> => {
    const { data, error } = await query;
    if (error) errors.push(`${label}: ${error.message}`);
    return data ?? [];
  };
  const drop = async (table: string, column: string, ids: (number | string)[]) => {
    if (!ids.length) return;
    const { error } = await database.from(table).delete().in(column, ids);
    if (error) errors.push(`delete ${table}: ${error.message}`);
  };

  const users = track.users;
  const exams = new Set(track.exams);
  const questions = new Set(track.questions);
  const modules = new Set(track.modules);
  const urls = new Set(track.permittedUrls);
  const cheatings = new Set(track.cheatings);

  if (users.length) {
    for (const row of await rows(database.from('exams').select('id').in('created_by', users), 'sweep exams')) exams.add(row.id);
    for (const row of await rows(database.from('questions').select('id').in('created_by', users), 'sweep questions')) questions.add(row.id);
    for (const row of await rows(database.from('module_professor').select('module_id').in('professor_id', users), 'sweep modules')) modules.add(row.module_id);
  }
  for (const row of await rows(database.from('permitted_urls').select('id').like('url', `https://e2e-${RUN}.example/%`), 'sweep urls')) urls.add(row.id);

  const examIds = [...exams];
  const attemptIds = examIds.length
    ? (await rows(database.from('assignments').select('id').in('exam_id', examIds), 'sweep attempts')).map((row) => row.id)
    : [];

  const media: Record<string, Set<number>> = {};
  for (const [kind, spec] of Object.entries(MEDIA)) {
    media[kind] = new Set(track.media[kind]);
    if (!attemptIds.length) continue;
    for (const row of await rows(database.from(spec.join).select(spec.column).in('assignment_id', attemptIds), `sweep ${kind}`)) media[kind].add(row[spec.column]);
  }
  if (attemptIds.length) {
    for (const row of await rows(database.from('cheating_reason').select('cheating_id').in('assignment_id', attemptIds), 'sweep cheatings')) cheatings.add(row.cheating_id);
    for (const row of await rows(database.from('exam_permitted_url').select('permitted_url_id').in('exam_id', examIds), 'sweep exam urls')) urls.add(row.permitted_url_id);
  }

  await drop('exams', 'id', examIds);
  for (const [kind, spec] of Object.entries(MEDIA)) await drop(spec.table, 'id', [...media[kind]]);
  await drop('cheatings', 'id', [...cheatings]);
  await drop('questions', 'id', [...questions]);
  await drop('modules', 'id', [...modules]);
  await drop('permitted_urls', 'id', [...urls]);
  // selects cap at 1000 rows so delete these by marker
  const { error: bulkError } = await database.from('permitted_urls').delete().like('url', `https://e2e-${RUN}.example/%`);
  if (bulkError) errors.push(`delete bulk urls: ${bulkError.message}`);
  if (track.jwts.size) await drop('tokens', 'token', [...track.jwts]);
  await drop('users', 'id', users);

  return errors;
};

const tableCounts = () => {
  const url = process.env.DATABASE_DIRECT_URL;
  if (!url) return null;
  const sql = `do $$ declare r record; c bigint; begin for r in select tablename from pg_tables where schemaname='public' order by 1 loop execute format('select count(*) from public.%I', r.tablename) into c; raise notice 'COUNT|%|%', r.tablename, c; end loop; end $$`;
  const out = spawnSync('psql', [url, '-At', '-c', sql], { encoding: 'utf8' });
  // never print the command line, it carries the connection string
  if (out.status !== 0) return null;
  const counts: Record<string, number> = {};
  for (const line of out.stderr.split('\n')) {
    const match = /COUNT\|(\w+)\|(\d+)/.exec(line);
    if (match) counts[match[1]] = Number(match[2]);
  }
  return counts;
};

const flow = async () => {
  await startServer();
  console.log(`server up on ${PORT}, run ${RUN}`);

  const prof = await seedUser('professor', 'prof');
  const prof2 = await seedUser('professor', 'prof2');
  const exm = await seedUser('examiner', 'exm');
  const stu1 = await seedUser('student', 'stu1');
  const stu2 = await seedUser('student', 'stu2');
  const [P, P2, E, S1, S2] = [prof.client, prof2.client, exm.client, stu1.client, stu2.client];
  const anon = new Client('anon');

  // ---------- auth ----------
  let res = await anon.post('/api/auth/login', { email: prof.email });
  status('login without password', res, 400);
  res = await anon.post('/api/auth/login', { email: prof.email, password: 'wrong-password' });
  const wrongPassword = res;
  status('login wrong password', res, 400);
  res = await anon.post('/api/auth/login', { email: `nobody-${RUN}@example.test`, password: 'whatever1' });
  status('login unknown email (.single() on zero rows)', res, 400);
  check('login: unknown email and wrong password answer the same message', res.body?.message === wrongPassword.body?.message, `${res.body?.message} / ${wrongPassword.body?.message}`);

  for (const user of [prof, prof2, exm, stu1, stu2]) {
    res = await login(user);
    status(`login ${user.client.label}`, res, 200);
    check(`login ${user.client.label}: user in body, no password`, res.body?.success === true && res.body.user?.id === user.id && !hasKey(res.body, 'password'), JSON.stringify(res.body));
    const cookie = res.cookies.find((line) => line.startsWith('jwt='));
    check(`login ${user.client.label}: jwt cookie is httpOnly`, Boolean(cookie && /httponly/i.test(cookie)), cookie ? 'no HttpOnly' : 'no cookie');
  }

  res = await anon.get('/api/auth/get-user');
  status('get-user without cookie', res, 401);
  res = await P.get('/api/auth/get-user');
  status('get-user professor', res, 200);
  check('get-user payload id/role/email', res.body?.id === prof.id && res.body?.role === 'professor' && res.body?.email === prof.email, JSON.stringify(res.body));
  res = await S1.get('/api/auth/get-user');
  check('get-user student role', res.body?.role === 'student', JSON.stringify(res.body));
  res = await E.get('/api/auth/get-user');
  check('get-user examiner role', res.body?.role === 'examiner', JSON.stringify(res.body));

  // ---------- role gates ----------
  res = await anon.get('/api/modules');
  status('modules without cookie', res, 401);
  res = await S1.post('/api/modules', { name: 'nope' });
  status('student creates module', res, 403);
  res = await E.get('/api/modules');
  status('examiner lists modules', res, 403);
  res = await S1.post('/api/exams', { name: 'nope' });
  status('student creates exam', res, 403);
  res = await S1.get('/api/questions');
  status('student lists questions', res, 403);
  res = await E.post('/api/questions', {});
  status('examiner creates question', res, 403);

  // ---------- modules ----------
  res = await P.post('/api/modules', {});
  status('create module without name', res, 400);
  res = await P.post('/api/modules', { name: `E2E module ${RUN}` });
  status('create module', res, 201);
  const mod = must(res.body?.module, 'module');
  track.modules.push(mod.id);
  check('module has id/name/created_at', typeof mod.id === 'number' && mod.name === `E2E module ${RUN}` && typeof mod.created_at === 'string', JSON.stringify(mod));
  const created = mod.created_at as string;

  res = await P2.post('/api/modules', { name: `E2E module2 ${RUN}` });
  status('professor 2 creates own module', res, 201);
  const mod2 = must(res.body?.module, 'module 2');
  track.modules.push(mod2.id);

  res = await P.post(`/api/modules/${mod.id}/students`, { email: stu1.email.toUpperCase() });
  status('enroll student by email (case insensitive)', res, 201);
  check('enroll by email answers the person', res.body?.student?.id === stu1.id && !hasKey(res.body, 'password'), JSON.stringify(res.body));
  res = await P.post(`/api/modules/${mod.id}/students`, { studentId: stu2.id });
  status('enroll student by id', res, 201);
  res = await P.post(`/api/modules/${mod.id}/students`, { studentId: stu2.id });
  status('enroll same student again (23505 from insert)', res, 409);
  res = await P.post(`/api/modules/${mod.id}/students`, { studentId: exm.id });
  status('enroll a non student', res, 400);
  res = await P.post(`/api/modules/${mod.id}/students`, { studentId: 999999999 });
  status('enroll unknown user', res, 404);
  res = await P.post(`/api/modules/${mod.id}/students`, {});
  status('enroll without email or id', res, 400);

  res = await P.get('/api/modules');
  status('professor lists modules', res, 200);
  check('list shows the module with student_count 2', res.body?.modules?.some((row: any) => row.id === mod.id && row.student_count === 2), JSON.stringify(res.body));
  res = await S1.get('/api/modules');
  check('student lists enrolled module', res.status === 200 && res.body?.modules?.length === 1 && res.body.modules[0].id === mod.id, JSON.stringify(res.body));
  res = await S1.get(`/api/modules/${mod.id}`);
  status('student reads own module', res, 200);
  res = await P.get(`/api/modules/${mod.id}/roster`);
  status('roster', res, 200);
  check('roster: 1 professor, 2 students', res.body?.professors?.length === 1 && res.body?.students?.length === 2, JSON.stringify(res.body));
  res = await S1.get(`/api/modules/${mod.id}/roster`);
  status('student reads roster', res, 403);
  res = await P2.get(`/api/modules/${mod.id}`);
  status('other professor reads module', res, 404);
  res = await P2.get(`/api/modules/${mod.id}/roster`);
  status('other professor reads roster', res, 404);
  res = await P2.patch(`/api/modules/${mod.id}`, { name: 'hijack' });
  status('other professor renames module', res, 404);
  res = await P.get('/api/modules/abc');
  status('module id that is not an id', res, 404);
  res = await P.patch(`/api/modules/${mod.id}`, { name: `E2E module ${RUN} renamed` });
  status('rename module', res, 200);
  check('rename returns the row and bumps updated_at', res.body?.module?.name.endsWith('renamed') && res.body.module.updated_at >= created, JSON.stringify(res.body));

  // ---------- questions ----------
  res = await P.post('/api/questions', { title: 'bad', questionType: 'multiple_choice', options: [{ optionText: 'only', isCorrect: true }] });
  status('multiple choice with one option', res, 400);
  res = await P.post('/api/questions', { title: 'bad', questionType: 'essay', options: [{ optionText: 'x' }] });
  status('essay with options', res, 400);

  const optionsOf = (question: any) => question.options as { id: number; option_text: string; is_correct: boolean }[];
  res = await P.post('/api/questions', {
    title: `E2E MC ${RUN}`, questionType: 'multiple_choice', question: 'Pick the primes', expectedDuration: 60, expectedDurationUnit: 'seconds',
    options: [{ optionText: '2', isCorrect: true }, { optionText: '4' }, { optionText: '5', isCorrect: true }, { optionText: '6' }],
  });
  status('create multiple choice question', res, 201);
  const mc = must(res.body?.question, 'mc');
  track.questions.push(mc.id);
  check('mc: 4 options, 2 correct, created_by is the caller', optionsOf(mc).length === 4 && optionsOf(mc).filter((o) => o.is_correct).length === 2 && mc.created_by === prof.id, JSON.stringify(mc));

  res = await P.post('/api/questions', {
    title: `E2E TF ${RUN}`, questionType: 'true_false', question: 'The sky is blue', expectedDuration: 30, expectedDurationUnit: 'seconds',
    options: [{ optionText: 'True', isCorrect: true }, { optionText: 'False' }],
  });
  status('create true_false question', res, 201);
  const tf = must(res.body?.question, 'tf');
  track.questions.push(tf.id);

  res = await P.post('/api/questions', { title: `E2E SA ${RUN}`, questionType: 'short_answer', question: 'Explain binary search', expectedDuration: 5, expectedDurationUnit: 'minutes' });
  status('create short_answer question', res, 201);
  const sa = must(res.body?.question, 'sa');
  track.questions.push(sa.id);
  check('short answer has no options', optionsOf(sa).length === 0, JSON.stringify(sa));

  res = await P.post('/api/questions', { title: `E2E essay ${RUN}`, questionType: 'essay', question: 'Discuss', expectedDuration: 10, expectedDurationUnit: 'minutes' });
  const essay = must(res.body?.question, 'essay');
  track.questions.push(essay.id);
  res = await P.post('/api/questions', {
    title: `E2E spare ${RUN}`, questionType: 'true_false', question: 'Spare', options: [{ optionText: 'True' }, { optionText: 'False', isCorrect: true }],
  });
  const spare = must(res.body?.question, 'spare');
  track.questions.push(spare.id);

  res = await P.get('/api/questions');
  status('list own questions', res, 200);
  check('list has the 5 questions', res.body?.questions?.length === 5, JSON.stringify(res.body?.questions?.length));
  res = await P.get('/api/questions?questionType=short_answer');
  check('filter by type', res.body?.questions?.length === 1 && res.body.questions[0].id === sa.id, JSON.stringify(res.body));
  res = await P.get(`/api/questions?search=${encodeURIComponent(`e2e mc ${RUN}`)}`);
  check('search on the title (ilike)', res.body?.questions?.length === 1 && res.body.questions[0].id === mc.id, JSON.stringify(res.body));
  res = await P.get('/api/questions?questionType=nope');
  status('filter by unknown type', res, 400);
  res = await P.get(`/api/questions/${mc.id}`);
  status('read own question', res, 200);
  check('read question carries its options with is_correct', optionsOf(res.body.question).length === 4 && hasKey(res.body, 'is_correct'), JSON.stringify(res.body));
  res = await P2.get(`/api/questions/${mc.id}`);
  status('other professor reads a question that is in no exam of theirs', res, 404);
  res = await P.patch(`/api/questions/${spare.id}`, { title: `E2E spare ${RUN} v2` });
  status('update question fields', res, 200);
  res = await P.patch(`/api/questions/${spare.id}`, { options: [{ optionText: 'Yes', isCorrect: true }, { optionText: 'No' }] });
  status('replace the options of an unanswered question', res, 200);
  check('options replaced (2 live options, new texts)', optionsOf(res.body.question).length === 2 && optionsOf(res.body.question)[0].option_text === 'Yes', JSON.stringify(res.body));
  res = await P.get(`/api/questions/${spare.id}`);
  check('soft deleted old options are not listed', optionsOf(res.body.question).length === 2, JSON.stringify(res.body));
  res = await P2.patch(`/api/questions/${spare.id}`, { title: 'hijack' });
  status('other professor updates question', res, 404);

  // ---------- exam 1: the main flow ----------
  const startIso = iso(-10 * MIN);
  const endIso = iso(120 * MIN);
  res = await P.post('/api/exams', { name: 'x', scheduledStart: endIso, scheduledEnd: startIso });
  status('create exam with end before start', res, 400);
  res = await P.post('/api/exams', { name: `E2E exam ${RUN}`, scheduledStart: startIso, scheduledEnd: endIso, maxMarks: 20, passingMarks: 10, shuffleQuestions: true });
  status('create exam', res, 201);
  const exam = must(res.body?.exam, 'exam');
  track.exams.push(exam.id);
  check('exam: scheduled, owner is the professor', exam.status === 'scheduled' && exam.created_by === prof.id && exam.max_marks === 20, JSON.stringify(exam));
  note(`(g) exam.scheduled_start sent ${startIso} came back ${exam.scheduled_start}; created_at ${exam.created_at}`);
  check('(g) timestamps parse and round trip to the millisecond', Date.parse(exam.scheduled_start) === Date.parse(startIso) && Date.parse(exam.created_at) > 0 && !Number.isNaN(Date.parse(exam.updated_at)), `${exam.scheduled_start} ${exam.created_at}`);
  const examId = exam.id as number;

  res = await P2.get(`/api/exams/${examId}`);
  status('other professor reads exam', res, 404);
  res = await P2.patch(`/api/exams/${examId}`, { name: 'hijack' });
  status('other professor updates exam', res, 404);
  res = await P2.patch(`/api/exams/${examId}/status`, { status: 'cancelled' });
  status('other professor changes exam status', res, 404);
  res = await P2.post(`/api/exams/${examId}/questions`, { questionId: mc.id });
  status('other professor attaches to exam', res, 404);
  res = await S1.patch(`/api/exams/${examId}`, { name: 'x' });
  status('student patches exam', res, 403);
  res = await P.get('/api/exams/0');
  status('exam id 0', res, 404);
  res = await P.get('/api/exams/999999999');
  status('exam that does not exist (.maybeSingle() zero rows)', res, 404);
  res = await P.patch(`/api/exams/${examId}`, {});
  status('update exam with nothing', res, 400);
  res = await P.patch(`/api/exams/${examId}`, { name: `E2E exam ${RUN}` });
  status('update exam name', res, 200);

  // modules
  res = await P.post(`/api/exams/${examId}/modules`, { moduleId: mod2.id });
  status('link a module the professor does not teach', res, 404);
  res = await P.post(`/api/exams/${examId}/modules`, { moduleId: mod.id });
  status('link module', res, 201);
  res = await P.post(`/api/exams/${examId}/modules`, { moduleId: mod.id });
  status('link module twice (23505)', res, 409);

  // questions: attach, marks, order
  res = await P.post(`/api/exams/${examId}/questions`, { questionId: mc.id, marks: 5 });
  status('attach mc', res, 201);
  check('mc goes to position 1', res.body?.question?.position === 1 && res.body.question.marks === 5, JSON.stringify(res.body));
  res = await P.post(`/api/exams/${examId}/questions`, { questionId: tf.id, marks: 5 });
  check('tf goes to position 2', res.status === 201 && res.body?.question?.position === 2, JSON.stringify(res.body));
  res = await P.post(`/api/exams/${examId}/questions`, { questionId: sa.id, marks: 10 });
  check('sa goes to position 3', res.status === 201 && res.body?.question?.position === 3, JSON.stringify(res.body));
  res = await P.post(`/api/exams/${examId}/questions`, { questionId: mc.id });
  status('attach the same question again (23505)', res, 409);
  res = await P.post(`/api/exams/${examId}/questions`, { questionId: spare.id, position: 1 });
  status('attach at a taken position (23505)', res, 409);
  res = await P.post(`/api/exams/${examId}/questions`, { questionId: 999999999 });
  status('attach unknown question', res, 404);

  res = await P.get(`/api/exams/${examId}/questions`);
  status('list exam questions', res, 200);
  check('marks_total 20 of max 20, order mc tf sa', res.body?.marks_total === 20 && res.body?.max_marks === 20 && res.body.questions.map((q: any) => q.id).join() === [mc.id, tf.id, sa.id].join(), JSON.stringify(res.body));
  res = await P.patch(`/api/exams/${examId}/questions/${tf.id}`, { marks: 3 });
  status('change marks of tf', res, 200);
  check('(d) update().select() returns the row', res.body?.question?.marks === 3 && res.body.question.question_id === tf.id, JSON.stringify(res.body));
  res = await P.patch(`/api/exams/${examId}/status`, { status: 'ongoing' });
  status('ongoing with marks 18 of 20', res, 409);
  res = await P.patch(`/api/exams/${examId}/questions/${spare.id}`, { marks: 3 });
  status('(d) update().select() on no matching row answers 404', res, 404);
  res = await P.patch(`/api/exams/${examId}/questions/${tf.id}`, { marks: 5 });
  status('marks of tf back to 5', res, 200);

  res = await P.put(`/api/exams/${examId}/questions/order`, { questionIds: [sa.id, mc.id] });
  status('reorder with a question missing', res, 400);
  res = await P.put(`/api/exams/${examId}/questions/order`, { questionIds: [sa.id, sa.id, mc.id] });
  status('reorder with a duplicate', res, 400);
  res = await P.put(`/api/exams/${examId}/questions/order`, { questionIds: [sa.id, mc.id, tf.id] });
  status('(c) reorder mc,tf,sa -> sa,mc,tf (every row changes position)', res, 200);
  const ordered = res.body?.questions as any[];
  check('(c) new order and positions 1..3', ordered?.map((q) => q.id).join() === [sa.id, mc.id, tf.id].join() && ordered.map((q) => q.position).join() === '1,2,3', JSON.stringify(ordered?.map((q) => [q.id, q.position])));
  check('(c) marks kept by the upsert (sa 10, mc 5, tf 5)', ordered?.[0]?.marks === 10 && ordered?.[1]?.marks === 5 && ordered?.[2]?.marks === 5, JSON.stringify(ordered?.map((q) => q.marks)));
  // atomicity: an upsert that fails on its last row must leave every position where it was
  const probe = await database.from('exam_question').upsert(
    [{ exam_id: examId, question_id: sa.id, position: 2 }, { exam_id: examId, question_id: mc.id, position: 1 }, { exam_id: examId, question_id: 999999999, position: 4 }],
    { onConflict: 'exam_id,question_id' }
  );
  const after = await database.from('exam_question').select('question_id, position, marks').eq('exam_id', examId).order('position');
  check('(c) a failing upsert changes nothing (single statement)', probe.error?.code === '23503' && after.data?.map((r) => `${r.question_id}:${r.position}:${r.marks}`).join() === `${sa.id}:1:10,${mc.id}:2:5,${tf.id}:3:5`, `${probe.error?.code} ${JSON.stringify(after.data)}`);
  note(`(c) rotating all 3 positions in one upsert worked (unique(exam_id, position) is deferrable initially immediate: checked at the end of the statement); a failing 3rd row (${probe.error?.code}) rolled back the two swaps`);

  // examiner, students, events, urls
  res = await P.post(`/api/exams/${examId}/examiners`, { examinerId: stu1.id });
  status('assign a student as examiner', res, 404);
  res = await P.post(`/api/exams/${examId}/examiners`, { examinerId: exm.id });
  status('assign examiner', res, 201);
  res = await P.post(`/api/exams/${examId}/examiners`, { examinerId: exm.id });
  status('assign examiner twice (23505)', res, 409);

  res = await P.post(`/api/exams/${examId}/students`, {});
  status('assign students without target', res, 400);
  res = await P.post(`/api/exams/${examId}/students`, { studentId: exm.id });
  status('assign a user who is in no linked module', res, 404);
  res = await P.post(`/api/exams/${examId}/students`, { studentId: stu1.id });
  status('assign one student', res, 201);
  check('added [stu1]', JSON.stringify(res.body?.added) === JSON.stringify([stu1.id]), JSON.stringify(res.body));
  res = await P.post(`/api/exams/${examId}/students`, { studentId: stu1.id });
  status('assign the same student again (23505)', res, 409);
  res = await P.post(`/api/exams/${examId}/students`, { moduleId: mod.id });
  status('assign the module students', res, 201);
  check('added only [stu2] (in() skips the assigned one)', JSON.stringify(res.body?.added) === JSON.stringify([stu2.id]), JSON.stringify(res.body));
  res = await P.post(`/api/exams/${examId}/students`, { moduleId: mod2.id });
  status('assign students of a module that is not linked', res, 404);

  res = await E.get('/api/exams/events');
  status('event catalog (examiner)', res, 200);
  const events = res.body?.events as any[];
  check('catalog has the 13 seeded events', events?.length === 13, String(events?.length));
  const eventId = (name: string) => must(events?.find((event) => event.name === name), name).id as number;
  res = await S1.get('/api/exams/events');
  status('student reads the event catalog', res, 403);
  for (const name of ['tab_switch', 'devtools_opened', 'copy_paste']) {
    res = await P.post(`/api/exams/${examId}/events`, { eventId: eventId(name) });
    status(`monitor ${name}`, res, 201);
  }
  res = await P.post(`/api/exams/${examId}/events`, { eventId: eventId('tab_switch') });
  status('monitor the same event twice (23505)', res, 409);
  res = await P.post(`/api/exams/${examId}/events`, { eventId: 999999999 });
  status('monitor an unknown event', res, 404);

  const url = `https://e2e-${RUN}.example/docs`;
  res = await P.post(`/api/exams/${examId}/permitted-urls`, { url: 'ftp://x.example/a' });
  status('permit an ftp url', res, 400);
  res = await P.post(`/api/exams/${examId}/permitted-urls`, { url });
  status('permit a url', res, 201);
  const permitted = must(res.body?.permitted_url, 'permitted url');
  track.permittedUrls.push(permitted.id);
  res = await P.post(`/api/exams/${examId}/permitted-urls`, { url });
  status('permit the same url twice (23505 on the link)', res, 409);

  // reads
  res = await P.get(`/api/exams/${examId}`);
  status('professor reads exam detail', res, 200);
  const detail = res.body?.exam;
  check('detail: 1 module, 1 examiner, 2 students, 3 events, 1 url, 3 questions, marks_total 20',
    detail?.modules?.length === 1 && detail.examiners?.length === 1 && detail.students?.length === 2 && detail.events?.length === 3 && detail.permitted_urls?.length === 1 && detail.questions?.length === 3 && detail.marks_total === 20,
    JSON.stringify({ m: detail?.modules?.length, e: detail?.examiners?.length, s: detail?.students?.length, ev: detail?.events?.length, u: detail?.permitted_urls?.length, q: detail?.questions?.length, t: detail?.marks_total }));
  check('detail options carry is_correct for staff', hasKey(detail?.questions, 'is_correct'), '');
  res = await E.get(`/api/exams/${examId}`);
  check('examiner reads exam detail', res.status === 200 && res.body?.exam?.questions?.length === 3, JSON.stringify(res.body).slice(0, 200));
  res = await S1.get(`/api/exams/${examId}`);
  status('student reads exam', res, 200);
  check('student exam: no questions, no owner, urls yes', !('questions' in res.body.exam) && !('created_by' in res.body.exam) && res.body.exam.permitted_urls?.length === 1, JSON.stringify(res.body));
  res = await P.get('/api/exams');
  check('professor list has the exam', res.status === 200 && res.body?.exams?.some((row: any) => row.id === examId), JSON.stringify(res.body));
  res = await S1.get('/api/exams');
  check('student list is the reduced shape', res.status === 200 && res.body?.exams?.length === 1 && !('created_by' in res.body.exams[0]), JSON.stringify(res.body));
  res = await E.get('/api/exams');
  check('examiner list has the exam', res.status === 200 && res.body?.exams?.some((row: any) => row.id === examId), JSON.stringify(res.body));
  res = await P2.get('/api/exams');
  check('other professor list is empty', res.status === 200 && res.body?.exams?.length === 0, JSON.stringify(res.body));

  res = await P.patch(`/api/exams/${examId}/status`, { status: 'bogus' });
  status('invalid status', res, 400);
  res = await P.patch(`/api/exams/${examId}/status`, { status: 'ongoing' });
  status('exam goes ongoing', res, 200);
  check('status ongoing in body', res.body?.exam?.status === 'ongoing', JSON.stringify(res.body));
  res = await P.patch(`/api/exams/${examId}/status`, { status: 'scheduled' });
  status('ongoing back to scheduled', res, 409);

  // ---------- exam 3: detach / unlink semantics, before any attempt exists ----------
  res = await P.post('/api/exams', { name: `E2E exam3 ${RUN}`, scheduledStart: iso(-5 * MIN), scheduledEnd: iso(60 * MIN), maxMarks: 10 });
  const exam3 = must(res.body?.exam, 'exam3');
  track.exams.push(exam3.id);
  const e3 = `/api/exams/${exam3.id}`;
  res = await P.patch(e3, { scheduledEnd: iso(-20 * MIN) });
  status('exam3 end before start', res, 400);
  res = await P.patch(e3, { scheduledStart: iso(-6 * MIN), scheduledEnd: iso(90 * MIN), passingMarks: 4 });
  status('exam3 reschedule (no attempts yet)', res, 200);
  res = await S1.post('/api/assignments', { examId: exam3.id });
  status('student starts an exam they are not assigned to', res, 404);
  res = await P.post(`${e3}/modules`, { moduleId: mod.id });
  status('exam3 link module', res, 201);
  res = await P.del(`${e3}/modules/${mod.id}`);
  status('(d) unlink module', res, 200);
  res = await P.del(`${e3}/modules/${mod.id}`);
  status('(d) unlink module again (delete().select() empty array)', res, 404);
  res = await P.post(`${e3}/modules`, { moduleId: mod.id });
  res = await P.post(`${e3}/students`, { studentId: stu1.id });
  status('exam3 assign student', res, 201);
  res = await P.del(`${e3}/students/${stu1.id}`);
  status('exam3 remove student', res, 200);
  res = await P.del(`${e3}/students/${stu1.id}`);
  status('exam3 remove student again', res, 404);
  res = await P.post(`${e3}/examiners`, { examinerId: exm.id });
  res = await P.del(`${e3}/examiners/${exm.id}`);
  status('exam3 remove examiner', res, 200);
  res = await P.del(`${e3}/examiners/${exm.id}`);
  status('exam3 remove examiner again', res, 404);
  res = await P.post(`${e3}/events`, { eventId: eventId('url_access') });
  res = await P.del(`${e3}/events/${eventId('url_access')}`);
  status('exam3 detach event', res, 200);
  res = await P.del(`${e3}/events/${eventId('url_access')}`);
  status('exam3 detach event again', res, 404);
  res = await P.post(`${e3}/permitted-urls`, { url });
  status('exam3 permits the same url', res, 201);
  check('the url row is shared, not duplicated', res.body?.permitted_url?.id === permitted.id, JSON.stringify(res.body));
  res = await P.del(`${e3}/permitted-urls/${permitted.id}`);
  status('exam3 stops permitting the url', res, 200);
  res = await P.del(`${e3}/permitted-urls/${permitted.id}`);
  status('exam3 stops permitting the url again', res, 404);
  res = await P.post(`${e3}/questions`, { questionId: essay.id, marks: 10 });
  status('exam3 attach essay', res, 201);
  res = await P.patch(`${e3}/questions/${essay.id}`, { marks: 9 });
  check('exam3 change marks', res.status === 200 && res.body?.question?.marks === 9, JSON.stringify(res.body));
  res = await P.del(`${e3}/questions/${essay.id}`);
  status('exam3 detach question', res, 200);
  res = await P.del(`${e3}/questions/${essay.id}`);
  status('exam3 detach question again', res, 404);

  // (a) (b) the rpc called directly, on the exam that has no attempt yet
  const startedAt = new Date().toISOString();
  const wrongNames = await database.rpc('start_attempt', { student_id: stu2.id, exam_id: exam3.id, session_duration: 60, started_at: startedAt });
  note(`(a) rpc with wrong argument names -> code ${wrongNames.error?.code}: ${wrongNames.error?.message}`);
  const first = await database.rpc('start_attempt', { param_student_id: stu2.id, param_exam_id: exam3.id, param_session_duration: 60, param_started_at: startedAt });
  const raw = first.data as any;
  check('(a) rpc with param_* names works and the json arrives as the object itself', !first.error && raw !== null && typeof raw === 'object' && !Array.isArray(raw) && typeof raw.id === 'number' && raw.exam_id === exam3.id && raw.status === 'in_progress' && raw.session_duration === 60, JSON.stringify(first));
  note(`(a) rpc data keys: ${Object.keys(raw ?? {}).join(',')}; started_at raw ${raw?.started_at} (sent ${startedAt}); Date.parse -> ${Date.parse(raw?.started_at)}`);
  check('(g) rpc started_at parses to the sent instant', Date.parse(raw?.started_at) === Date.parse(startedAt), `${raw?.started_at} vs ${startedAt}`);
  const second = await database.rpc('start_attempt', { param_student_id: stu2.id, param_exam_id: exam3.id, param_session_duration: 60, param_started_at: startedAt });
  check('(b) second rpc for the same student and exam surfaces error.code 23505', second.error?.code === '23505' && second.data === null, JSON.stringify(second.error));
  const rows = await database.from('assignments').select('id', { count: 'exact' }).eq('exam_id', exam3.id);
  check('(b) the failed call rolled back (still exactly one assignments row)', rows.count === 1, String(rows.count));
  note(`(b) 23505 message: ${second.error?.message}`);

  // structural edits are closed once an attempt exists (this attempt is on exam3)
  res = await P.patch(e3, { scheduledEnd: iso(100 * MIN) });
  status('exam3 reschedule with an attempt', res, 409);
  res = await P.del(e3, {});
  status('delete exam without reason', res, 400);
  res = await P.del(e3, { reason: 'e2e cleanup' });
  status('soft delete exam3', res, 200);
  res = await P.get(e3);
  status('soft deleted exam is gone', res, 404);
  const soft = await database.from('exams').select('deleted_at, reason').eq('id', exam3.id).single();
  check('exam3 row is kept with deleted_at and reason', Boolean(soft.data?.deleted_at) && soft.data?.reason === 'e2e cleanup', JSON.stringify(soft));
  res = await P.patch(`${e3}/status`, { status: 'cancelled' });
  status('status of a soft deleted exam', res, 404);

  // ---------- attempt on exam 1 ----------
  res = await anon.post('/api/assignments', { examId });
  status('start attempt without cookie', res, 401);
  res = await P.post('/api/assignments', { examId });
  status('professor starts an attempt', res, 403);
  res = await S1.post('/api/assignments', {});
  status('start attempt without examId', res, 400);
  res = await S1.post('/api/assignments', { examId });
  status('student starts the attempt (start_attempt rpc)', res, 201);
  const attempt = must(res.body?.attempt, 'attempt');
  const attemptId = attempt.id as number;
  const qs = attempt.questions as any[];
  check('attempt: in_progress, session 390s, 3 questions, 1 permitted url', attempt.status === 'in_progress' && attempt.session_duration === 390 && qs.length === 3 && attempt.permitted_urls.length === 1, JSON.stringify({ s: attempt.status, d: attempt.session_duration, q: qs.length, u: attempt.permitted_urls }));
  check('attempt positions are a permutation of 1..3', sorted(qs.map((q) => q.position)).join() === '1,2,3', JSON.stringify(qs.map((q) => q.position)));
  check('attempt options: mc 4, tf 2, sa 0, marks carried', qs.find((q) => q.question_id === mc.id)?.options.length === 4 && qs.find((q) => q.question_id === tf.id)?.options.length === 2 && qs.find((q) => q.question_id === sa.id)?.options.length === 0 && qs.find((q) => q.question_id === sa.id)?.marks === 10, JSON.stringify(qs.map((q) => [q.question_id, q.options.length, q.marks])));
  check('no is_correct anywhere in the student attempt', !JSON.stringify(res.body).includes('is_correct'), '');
  check('remaining_seconds within the 390s limit', attempt.remaining_seconds > 380 && attempt.remaining_seconds <= 390, String(attempt.remaining_seconds));
  check('expires_at = started_at + 390s', Math.abs(Date.parse(attempt.expires_at) - (Date.parse(attempt.started_at) + 390000)) < 1000, `${attempt.started_at} ${attempt.expires_at}`);
  note(`(g) attempt.started_at ${attempt.started_at} exam.scheduled_end ${attempt.exam.scheduled_end}`);
  const links = await Promise.all([
    database.from('question_assignment').select('question_id', { count: 'exact', head: true }).eq('assignment_id', attemptId),
    database.from('assignment_permitted_url').select('permitted_url_id', { count: 'exact', head: true }).eq('assignment_id', attemptId),
    database.from('student_assignment').select('student_id', { count: 'exact', head: true }).eq('assignment_id', attemptId).eq('student_id', stu1.id),
  ]);
  check('rpc wrote 3 question_assignment, 1 permitted url link, 1 student link', links.map((r) => r.count).join() === '3,1,1', links.map((r) => r.count).join());

  res = await S1.post('/api/assignments', { examId });
  status('second start of the same exam', res, 409);
  const direct = await database.rpc('start_attempt', { param_student_id: stu1.id, param_exam_id: examId, param_session_duration: 60, param_started_at: new Date().toISOString() });
  check('(b) direct rpc for an existing attempt is 23505 too', direct.error?.code === '23505', JSON.stringify(direct.error));

  res = await S1.get(`/api/assignments/${attemptId}`);
  status('student reads own attempt', res, 200);
  check('student read: no is_correct, no score', !JSON.stringify(res.body).includes('is_correct') && !('score' in res.body.attempt), '');
  res = await S2.get(`/api/assignments/${attemptId}`);
  status('other student reads the attempt', res, 404);
  res = await S2.put(`/api/assignments/${attemptId}/answers`, { answers: [{ questionId: sa.id, answer: 'x' }] });
  status('other student syncs answers', res, 404);
  res = await S2.post(`/api/assignments/${attemptId}/submit`);
  status('other student submits', res, 404);
  res = await S2.post(`/api/monitoring/attempts/${attemptId}/snapshots`, { url: 'https://media.example/x.png' });
  status('other student posts media', res, 404);
  res = await S2.post(`/api/cheatings/attempts/${attemptId}`, { name: 'devtools', explanation: 'x' });
  status('other student reports an incident', res, 404);
  res = await P2.get(`/api/assignments/${attemptId}`);
  status('other professor reads the attempt', res, 404);
  res = await P2.get(`/api/assignments?examId=${examId}`);
  status('other professor lists attempts', res, 404);
  res = await S1.get('/api/assignments/abc');
  status('attempt id that is not an id', res, 404);
  res = await E.get(`/api/assignments/${attemptId}`);
  status('examiner reads the attempt', res, 200);
  const staff = res.body.attempt;
  check('staff view: is_correct, student, paste_ratio, status in_progress', hasKey(staff, 'is_correct') && staff.student?.id === stu1.id && staff.status === 'in_progress' && staff.questions.every((q: any) => 'paste_ratio' in q), JSON.stringify(staff).slice(0, 300));
  res = await P.get(`/api/assignments/${attemptId}`);
  status('professor reads the attempt', res, 200);

  // sync
  const mcOptions = optionsOf(mc);
  const tfOptions = optionsOf(tf);
  const mcRight = mcOptions.filter((o) => o.is_correct).map((o) => o.id);
  const tfRight = tfOptions.filter((o) => o.is_correct).map((o) => o.id);
  res = await S1.put(`/api/assignments/${attemptId}/answers`, { answers: [] });
  status('sync an empty batch', res, 400);
  res = await S1.put(`/api/assignments/${attemptId}/answers`, { answers: [{ questionId: spare.id, answer: 'x' }] });
  status('sync a question that is not part of the attempt', res, 400);
  res = await S1.put(`/api/assignments/${attemptId}/answers`, { answers: [{ questionId: sa.id, answer: 'kept?' }, { questionId: mc.id, optionIds: [tfOptions[0].id] }] });
  status('sync with an option of another question', res, 400);
  res = await S1.get(`/api/assignments/${attemptId}`);
  check('a rejected batch wrote nothing', res.body.attempt.questions.find((q: any) => q.question_id === sa.id)?.answer === '', JSON.stringify(res.body.attempt.questions.find((q: any) => q.question_id === sa.id)));
  res = await S1.put(`/api/assignments/${attemptId}/answers`, {
    answers: [
      { questionId: mc.id, optionIds: mcRight },
      { questionId: tf.id, optionIds: tfRight },
      { questionId: sa.id, answer: 'Halve the range each step', typingDuration: 12, typingDurationUnit: 'seconds', textTyped: 25, textEdited: 3, textPasted: 5 },
    ],
  });
  status('sync 3 answers', res, 200);
  check('synced 3 with remaining_seconds', res.body?.synced === 3 && res.body.remaining_seconds > 300, JSON.stringify(res.body));
  res = await S1.put(`/api/assignments/${attemptId}/answers`, { answers: [{ questionId: mc.id, optionIds: [mcRight[0]] }] });
  status('replace the chosen options of mc', res, 200);
  res = await S1.get(`/api/assignments/${attemptId}`);
  let mcAnswer = res.body.attempt.questions.find((q: any) => q.question_id === mc.id);
  check('mc keeps only the replacement option', JSON.stringify(mcAnswer.selected_option_ids) === JSON.stringify([mcRight[0]]), JSON.stringify(mcAnswer));
  res = await S1.put(`/api/assignments/${attemptId}/answers`, { answers: [{ questionId: mc.id, optionIds: mcRight }] });
  res = await S1.get(`/api/assignments/${attemptId}`);
  mcAnswer = res.body.attempt.questions.find((q: any) => q.question_id === mc.id);
  const saAnswer = res.body.attempt.questions.find((q: any) => q.question_id === sa.id);
  check('mc has both correct options again', sorted(mcAnswer.selected_option_ids).join() === sorted(mcRight).join(), JSON.stringify(mcAnswer));
  check('sa keeps the text and the typing metrics', saAnswer.answer === 'Halve the range each step' && saAnswer.text_typed === 25 && saAnswer.text_pasted === 5 && saAnswer.typing_duration === 12 && Boolean(saAnswer.answered_at) && Boolean(saAnswer.last_synced_at), JSON.stringify(saAnswer));
  check('remaining_seconds is decreasing', res.body.attempt.remaining_seconds > 0 && res.body.attempt.remaining_seconds <= 390, String(res.body.attempt.remaining_seconds));
  res = await E.get(`/api/assignments/${attemptId}`);
  check('staff paste_ratio for sa = 5/30', res.body.attempt.questions.find((q: any) => q.question_id === sa.id)?.paste_ratio === 0.17, JSON.stringify(res.body.attempt.questions.find((q: any) => q.question_id === sa.id)));
  res = await S1.get('/api/assignments/my');
  check('my attempts lists it', res.status === 200 && res.body?.attempts?.length === 1 && res.body.attempts[0].id === attemptId, JSON.stringify(res.body));
  res = await P.get(`/api/assignments?examId=${examId}`);
  check('professor lists the attempts of the exam', res.status === 200 && res.body?.attempts?.length === 1 && res.body.attempts[0].student?.id === stu1.id && res.body.attempts[0].passed === null, JSON.stringify(res.body));
  res = await P.get(`/api/assignments?examId=${examId}&status=graded`);
  check('status filter (eq on an enum column)', res.status === 200 && res.body?.attempts?.length === 0, JSON.stringify(res.body));
  res = await P.get(`/api/assignments?examId=${examId}&status=bogus`);
  status('list attempts with a bad status', res, 400);
  res = await P.get('/api/assignments');
  status('list attempts without examId', res, 400);
  res = await S1.get(`/api/assignments?examId=${examId}`);
  status('student lists exam attempts', res, 403);

  // monitoring and cheating while the attempt runs
  res = await S1.post(`/api/monitoring/attempts/${attemptId}/nope`, { url: 'https://media.example/x.png' });
  status('unknown media kind', res, 404);
  res = await S1.post(`/api/monitoring/attempts/${attemptId}/snapshots`, { url: 'ftp://media.example/x.png' });
  status('media with an ftp url', res, 400);
  res = await P.post(`/api/monitoring/attempts/${attemptId}/snapshots`, { url: 'https://media.example/x.png' });
  status('professor posts media', res, 403);
  for (const kind of Object.keys(MEDIA)) {
    res = await S1.post(`/api/monitoring/attempts/${attemptId}/${kind}`, { url: `https://media.example/${RUN}/${kind}-1.png` });
    status(`student posts ${kind} media`, res, 201);
    if (res.body?.media?.id) track.media[kind].push(res.body.media.id);
    check(`${kind}: media row {id,url,created_at}`, typeof res.body?.media?.id === 'number' && typeof res.body.media.created_at === 'string', JSON.stringify(res.body));
  }
  res = await S1.post(`/api/monitoring/attempts/${attemptId}/snapshots`, { url: `https://media.example/${RUN}/snapshots-2.png` });
  if (res.body?.media?.id) track.media.snapshots.push(res.body.media.id);
  res = await E.get(`/api/monitoring/attempts/${attemptId}/snapshots`);
  status('examiner lists snapshots', res, 200);
  check('2 snapshots, newest first', res.body?.media?.length === 2 && res.body.media[0].url.endsWith('snapshots-2.png'), JSON.stringify(res.body));
  res = await S1.get(`/api/monitoring/attempts/${attemptId}/snapshots`);
  status('student reads media back', res, 403);
  res = await P2.get(`/api/monitoring/attempts/${attemptId}/snapshots`);
  status('other professor reads media', res, 404);

  res = await S1.post(`/api/cheatings/attempts/${attemptId}`, { name: 'manual_review', explanation: 'x' });
  status('student records a manual review', res, 403);
  res = await S1.post(`/api/cheatings/attempts/${attemptId}`, { name: 'bogus', explanation: 'x' });
  status('incident with an unknown type', res, 400);
  res = await S1.post(`/api/cheatings/attempts/${attemptId}`, { name: 'tab_switch_limit', explanation: 'left the tab 6 times' });
  status('student reports tab_switch_limit', res, 201);
  const incident = must(res.body?.cheating, 'incident');
  track.cheatings.push(incident.id);
  check('incident {id,name,explanation,created_at}', incident.name === 'tab_switch_limit' && typeof incident.created_at === 'string', JSON.stringify(incident));
  res = await S1.get(`/api/assignments/${attemptId}`);
  check('student never sees flagged (in_progress)', res.body.attempt.status === 'in_progress' && !JSON.stringify(res.body).includes('flagged'), JSON.stringify(res.body.attempt.status));
  res = await E.get(`/api/assignments/${attemptId}`);
  check('staff sees flagged', res.body.attempt.status === 'flagged', JSON.stringify(res.body.attempt.status));
  res = await S1.put(`/api/assignments/${attemptId}/answers`, { answers: [{ questionId: tf.id, optionIds: tfRight }] });
  status('a flagged attempt is still open for answers', res, 200);

  // submit
  res = await S1.post(`/api/assignments/${attemptId}/submit`);
  status('student submits', res, 200);
  check('student sees submitted, not flagged, not auto', res.body?.attempt?.status === 'submitted' && res.body.attempt.auto_submitted === false && Boolean(res.body.attempt.submitted_at) && !('score' in res.body.attempt), JSON.stringify(res.body));
  check('remaining_seconds 0 after submit', res.body?.attempt?.remaining_seconds === 0, '');
  const dbRow = await database.from('assignments').select('status, score').eq('id', attemptId).single();
  check('db keeps status flagged and the objective score 10 (mc 5 + tf 5)', dbRow.data?.status === 'flagged' && dbRow.data?.score === 10, JSON.stringify(dbRow));
  res = await S1.post(`/api/assignments/${attemptId}/submit`);
  status('submit twice', res, 409);
  res = await S1.put(`/api/assignments/${attemptId}/answers`, { answers: [{ questionId: sa.id, answer: 'late' }] });
  status('sync after submit', res, 409);
  res = await S1.post(`/api/monitoring/attempts/${attemptId}/snapshots`, { url: 'https://media.example/late.png' });
  status('media after submit', res, 409);
  res = await S1.post(`/api/cheatings/attempts/${attemptId}`, { name: 'devtools', explanation: 'late' });
  status('incident after submit', res, 409);

  // grading
  res = await S1.put(`/api/assignments/${attemptId}/grade`, { marks: [] });
  status('student grades', res, 403);
  res = await E.put(`/api/assignments/${attemptId}/grade`, { marks: [] });
  status('examiner grades', res, 403);
  res = await P2.put(`/api/assignments/${attemptId}/grade`, { marks: [] });
  status('other professor grades', res, 404);
  res = await P.put(`/api/assignments/${attemptId}/grade`, { marks: [{ questionId: mc.id, marks: 1 }] });
  status('grade an objective question by hand', res, 400);
  res = await P.put(`/api/assignments/${attemptId}/grade`, { marks: [{ questionId: sa.id, marks: 11 }] });
  status('award more than the question is worth', res, 400);
  res = await P.put(`/api/assignments/${attemptId}/grade`, { marks: [{ questionId: sa.id, marks: -1 }] });
  status('award a negative mark', res, 400);
  res = await P.put(`/api/assignments/${attemptId}/grade`, { marks: [{ questionId: sa.id, marks: 7 }], feedback: 'Good, missing the complexity' });
  status('professor grades the short answer (7)', res, 200);
  check('graded: score 17 <= max 20, passed, feedback', res.body?.attempt?.status === 'graded' && res.body.attempt.score === 17 && res.body.attempt.passed === true && res.body.attempt.feedback === 'Good, missing the complexity', JSON.stringify(res.body.attempt));
  res = await S1.get(`/api/assignments/${attemptId}`);
  const gradedView = res.body.attempt;
  check('student sees graded, score 17, marks_awarded 5/5/7, still no is_correct', gradedView.status === 'graded' && gradedView.score === 17 && gradedView.passed === true && gradedView.questions.find((q: any) => q.question_id === sa.id)?.marks_awarded === 7 && gradedView.questions.find((q: any) => q.question_id === mc.id)?.marks_awarded === 5 && !JSON.stringify(gradedView).includes('is_correct'), JSON.stringify(gradedView).slice(0, 300));
  res = await P.put(`/api/assignments/${attemptId}/grade`, { marks: [{ questionId: sa.id, marks: 10 }] });
  check('regrade to 10 -> total 20, never above max_marks', res.status === 200 && res.body?.attempt?.score === 20 && res.body.attempt.feedback === 'Good, missing the complexity', JSON.stringify(res.body));

  // incidents after grading
  res = await E.post(`/api/cheatings/attempts/${attemptId}`, { name: 'manual_review', explanation: 'paste ratio looked odd' });
  status('examiner records manual_review after grading', res, 201);
  track.cheatings.push(res.body?.cheating?.id);
  const manual = res.body?.cheating;
  res = await P.get(`/api/assignments/${attemptId}`);
  check('graded attempt is not flagged again', res.body?.attempt?.status === 'graded', JSON.stringify(res.body?.attempt?.status));
  res = await E.get(`/api/cheatings/summary?examId=${examId}`);
  status('examiner cheating summary', res, 200);
  check('summary: manual_review 1, tab_switch_limit 1', JSON.stringify(res.body?.summary) === JSON.stringify([{ name: 'manual_review', count: 1 }, { name: 'tab_switch_limit', count: 1 }]), JSON.stringify(res.body));
  res = await S1.get(`/api/cheatings/summary?examId=${examId}`);
  status('student reads the summary', res, 403);
  res = await E.get('/api/cheatings/summary');
  status('summary without examId', res, 400);
  res = await P2.get(`/api/cheatings/summary?examId=${examId}`);
  status('other professor reads the summary', res, 404);
  res = await E.get(`/api/cheatings/attempts/${attemptId}`);
  check('examiner lists 2 incidents', res.status === 200 && res.body?.cheatings?.length === 2, JSON.stringify(res.body));
  res = await E.get(`/api/cheatings/${incident.id}`);
  check('examiner reads one incident with assignment_id', res.status === 200 && res.body?.cheating?.assignment_id === attemptId, JSON.stringify(res.body));
  res = await S1.get(`/api/cheatings/${incident.id}`);
  status('student reads an incident', res, 403);
  res = await P2.get(`/api/cheatings/${incident.id}`);
  status('other professor reads an incident', res, 404);

  res = await E.del(`/api/cheatings/${incident.id}`, { reason: 'x' });
  status('examiner dismisses an incident', res, 403);
  res = await P2.del(`/api/cheatings/${incident.id}`, { reason: 'x' });
  status('other professor dismisses an incident', res, 404);
  res = await P.del(`/api/cheatings/${incident.id}`, {});
  status('dismiss without reason', res, 400);
  res = await P.del(`/api/cheatings/${incident.id}`, { reason: 'the tab was a permitted docs page' });
  status('professor dismisses the incident', res, 200);
  check('(d) dismissed answers {id,name,deleted_at,reason}', res.body?.cheating?.id === incident.id && Boolean(res.body.cheating.deleted_at) && res.body.cheating.reason === 'the tab was a permitted docs page', JSON.stringify(res.body));
  res = await P.del(`/api/cheatings/${incident.id}`, { reason: 'again' });
  status('(d) dismiss twice (update().select().maybeSingle() with no row)', res, 404);
  res = await E.get(`/api/cheatings/attempts/${attemptId}`);
  check('dismissed incident is left out of the list', res.body?.cheatings?.length === 1 && res.body.cheatings[0].id === manual.id, JSON.stringify(res.body));
  res = await E.get(`/api/cheatings/summary?examId=${examId}`);
  check('summary counts only the live one', JSON.stringify(res.body?.summary) === JSON.stringify([{ name: 'manual_review', count: 1 }]), JSON.stringify(res.body));
  res = await P.get(`/api/cheatings/${incident.id}`);
  status('read a dismissed incident', res, 404);

  // media delete
  const snapshotIds = track.media.snapshots;
  res = await E.del(`/api/monitoring/snapshots/${snapshotIds[0]}`, { reason: 'x' });
  status('examiner deletes media', res, 403);
  res = await P2.del(`/api/monitoring/snapshots/${snapshotIds[0]}`, { reason: 'x' });
  status('other professor deletes media', res, 404);
  res = await P.del(`/api/monitoring/snapshots/${snapshotIds[0]}`, {});
  status('delete media without reason', res, 400);
  res = await P.del(`/api/monitoring/nope/${snapshotIds[0]}`, { reason: 'x' });
  status('delete media of an unknown kind', res, 404);
  res = await P.del(`/api/monitoring/face-snapshots/999999999`, { reason: 'x' });
  status('delete a media id that does not exist in that kind', res, 404);
  res = await P.del(`/api/monitoring/snapshots/${snapshotIds[0]}`, { reason: 'blurred, not the student' });
  status('professor soft deletes a snapshot', res, 200);
  check('deleted media {id,url,deleted_at,reason}', res.body?.media?.id === snapshotIds[0] && Boolean(res.body.media.deleted_at) && res.body.media.reason === 'blurred, not the student', JSON.stringify(res.body));
  res = await P.del(`/api/monitoring/snapshots/${snapshotIds[0]}`, { reason: 'again' });
  status('(d) soft delete the same media twice', res, 404);
  res = await E.get(`/api/monitoring/attempts/${attemptId}/snapshots`);
  check('list leaves the deleted one out', res.status === 200 && res.body?.media?.length === 1 && res.body.media[0].id === snapshotIds[1], JSON.stringify(res.body));
  const link = await database.from('assignment_snapshot').select('snapshot_id').eq('assignment_id', attemptId);
  check('the join row stays after a soft delete', link.data?.length === 2, JSON.stringify(link.data));

  // structural edits once the exam has attempts
  res = await P.patch(`/api/exams/${examId}`, { scheduledEnd: iso(200 * MIN) });
  status('reschedule an exam with attempts', res, 409);
  res = await P.post(`/api/exams/${examId}/questions`, { questionId: spare.id });
  status('attach a question to an exam with attempts', res, 409);
  res = await P.del(`/api/exams/${examId}/students/${stu2.id}`);
  status('remove a student from an exam with attempts', res, 409);
  res = await P.patch(`/api/exams/${examId}`, { name: `E2E exam ${RUN} v2` });
  status('rename an exam with attempts stays allowed', res, 200);

  // questions frozen by the answers
  res = await P.patch(`/api/questions/${mc.id}`, { options: [{ optionText: 'a', isCorrect: true }, { optionText: 'b' }] });
  status('replace the options of an answered question', res, 409);
  res = await P.del(`/api/questions/${mc.id}`, {});
  status('delete an answered question', res, 409);
  res = await P.patch(`/api/questions/${mc.id}`, { title: `E2E MC ${RUN} v2` });
  status('rename an answered question stays allowed', res, 200);

  // ---------- exam 2: the time runs out ----------
  res = await P.post('/api/exams', { name: `E2E exam2 ${RUN}`, scheduledStart: iso(-60 * MIN), scheduledEnd: iso(60 * MIN), maxMarks: 10, passingMarks: 5, shuffleQuestions: false });
  status('create exam2', res, 201);
  const exam2 = must(res.body?.exam, 'exam2');
  track.exams.push(exam2.id);
  const e2 = `/api/exams/${exam2.id}`;
  res = await P.post(`${e2}/modules`, { moduleId: mod.id });
  res = await P.post(`${e2}/questions`, { questionId: mc.id, marks: 5 });
  status('exam2 attach mc (already answered elsewhere)', res, 201);
  res = await P.post(`${e2}/questions`, { questionId: sa.id, marks: 5 });
  res = await P.post(`${e2}/students`, { moduleId: mod.id });
  check('exam2 assigns both students', res.status === 201 && res.body?.added?.length === 2, JSON.stringify(res.body));
  res = await S1.post('/api/assignments', { examId: exam2.id });
  status('start on exam2 while it is still scheduled is allowed (scheduled status)', res, 201);
  const late = must(res.body?.attempt, 'late attempt');
  check('exam2 session is min(360s, window left) with shuffle off in exam_question order', late.session_duration === 360 && late.questions.map((q: any) => q.question_id).join() === [mc.id, sa.id].join(), JSON.stringify([late.session_duration, late.questions.map((q: any) => q.question_id)]));

  // two starts at once from the same student: one wins, the other is a 409 (pre check or 23505 from the rpc)
  const race = await Promise.all([S2.post('/api/assignments', { examId: exam2.id }), S2.post('/api/assignments', { examId: exam2.id })]);
  check('concurrent double start: exactly one 201 and one 409', race.map((r) => r.status).sort().join() === '201,409', JSON.stringify(race.map((r) => [r.status, r.body?.message])));
  const raceCount = await database.from('student_assignment').select('assignment_id', { count: 'exact', head: true }).eq('student_id', stu2.id).eq('exam_id', exam2.id);
  check('concurrent double start leaves exactly one attempt', raceCount.count === 1, String(raceCount.count));
  const lateId = late.id as number;
  const raceId = race.find((r) => r.status === 201)?.body?.attempt?.id as number;

  // push both attempts past their limit
  for (const id of [lateId, raceId]) {
    const { error } = await database.from('assignments').update({ started_at: iso(-3 * 60 * MIN) }).eq('id', id);
    if (error) throw new Error(error.message);
  }
  res = await S1.post(`/api/monitoring/attempts/${lateId}/snapshots`, { url: 'https://media.example/late.png' });
  status('media past the time limit (attempt still in_progress in the db)', res, 409);
  check('late media message says the time is up', /time is up/i.test(res.body?.message), res.body?.message);
  res = await S1.post(`/api/cheatings/attempts/${lateId}`, { name: 'devtools', explanation: 'late' });
  status('incident past the time limit', res, 409);
  const stillOpen = await database.from('assignments').select('status, submitted_at').eq('id', lateId).single();
  check('media/cheating never close the attempt themselves', stillOpen.data?.status === 'in_progress' && stillOpen.data?.submitted_at === null, JSON.stringify(stillOpen));

  res = await S1.get(`/api/assignments/${lateId}`);
  status('reading the expired attempt auto submits it', res, 200);
  check('auto_submitted true, status auto_submitted, remaining 0, no score for the student', res.body?.attempt?.auto_submitted === true && res.body.attempt.status === 'auto_submitted' && res.body.attempt.remaining_seconds === 0 && !('score' in res.body.attempt), JSON.stringify(res.body?.attempt));
  const autoRow = await database.from('assignments').select('status, auto_submitted, submitted_at, score').eq('id', lateId).single();
  check('db: auto_submitted, submitted_at set, score 0 (nothing answered)', autoRow.data?.status === 'auto_submitted' && autoRow.data.auto_submitted === true && Boolean(autoRow.data.submitted_at) && autoRow.data.score === 0, JSON.stringify(autoRow));
  res = await S1.post(`/api/assignments/${lateId}/submit`);
  status('submit an auto submitted attempt', res, 409);
  res = await S1.post(`/api/monitoring/attempts/${lateId}/snapshots`, { url: 'https://media.example/late2.png' });
  status('media after the auto submit', res, 409);
  res = await S2.put(`/api/assignments/${raceId}/answers`, { answers: [{ questionId: sa.id, answer: 'too late' }] });
  status('sync on an expired attempt (lazy auto submit through sync)', res, 409);
  check('sync message says the time is up', /time is up/i.test(res.body?.message), res.body?.message);
  const raceRow = await database.from('assignments').select('status, auto_submitted').eq('id', raceId).single();
  check('sync closed the attempt as auto_submitted', raceRow.data?.status === 'auto_submitted' && raceRow.data.auto_submitted === true, JSON.stringify(raceRow));
  res = await P.get(`/api/assignments?examId=${exam2.id}&status=auto_submitted`);
  check('professor lists the 2 auto submitted attempts', res.status === 200 && res.body?.attempts?.length === 2, JSON.stringify(res.body));
  res = await P.put(`/api/assignments/${lateId}/grade`, { marks: [{ questionId: sa.id, marks: 3 }] });
  check('an auto submitted attempt can be graded', res.status === 200 && res.body?.attempt?.status === 'graded' && res.body.attempt.score === 3, JSON.stringify(res.body));

  // ---------- co-professor sees what the module carries ----------
  res = await P2.post(`/api/modules/${mod.id}/professors`, { email: prof2.email });
  status('professor 2 adds themselves to a module they do not manage', res, 404);
  res = await P.post(`/api/modules/${mod.id}/professors`, { email: exm.email });
  status('add an examiner as co-professor', res, 400);
  res = await P.post(`/api/modules/${mod.id}/professors`, { email: prof2.email });
  status('add co-professor by email', res, 201);
  res = await P.post(`/api/modules/${mod.id}/professors`, { professorId: prof2.id });
  status('add the same co-professor again (23505)', res, 409);
  res = await P2.get(`/api/exams/${examId}`);
  check('co-professor now manages the exam through the module', res.status === 200 && res.body?.exam?.id === examId, JSON.stringify(res.body).slice(0, 150));
  res = await P2.get(`/api/assignments?examId=${examId}`);
  check('co-professor lists the attempts', res.status === 200 && res.body?.attempts?.length === 1, JSON.stringify(res.body));
  res = await P2.get(`/api/questions/${mc.id}`);
  status('co-professor reads a question their exam asks', res, 200);
  res = await P2.get('/api/exams');
  check('co-professor list has exam and exam2', res.status === 200 && res.body?.exams?.length === 2, JSON.stringify(res.body?.exams?.map((e: any) => e.id)));
  res = await P.del(`/api/modules/${mod.id}/professors/${prof2.id}`);
  status('remove the co-professor', res, 200);
  res = await P.del(`/api/modules/${mod.id}/professors/${prof2.id}`);
  status('remove the co-professor again', res, 404);
  res = await P2.get(`/api/exams/${examId}`);
  status('removed co-professor loses the exam', res, 404);

  // ---------- module and question clean deletes ----------
  res = await P.del(`/api/modules/${mod.id}/students/${stu2.id}`);
  status('remove a student from the module', res, 200);
  res = await P.del(`/api/modules/${mod.id}/students/${stu2.id}`);
  status('remove the student again', res, 404);
  res = await P.del(`/api/questions/${spare.id}`, { reason: 'e2e spare' });
  status('soft delete an unanswered question', res, 200);
  res = await P.get(`/api/questions/${spare.id}`);
  status('a soft deleted question is gone', res, 404);
  res = await P.del(`/api/modules/${mod.id}`, { reason: 'e2e done' });
  status('soft delete the module', res, 200);
  res = await P.get(`/api/modules/${mod.id}`);
  status('a soft deleted module is gone', res, 404);
  res = await P.get('/api/modules');
  check('module list no longer has it', res.status === 200 && !res.body?.modules?.some((m: any) => m.id === mod.id), JSON.stringify(res.body));

  // ---------- direct PostgREST semantics ----------
  const sampleId = stu1.id;
  let r: any = await database.from('users').select('id').eq('id', 999999999).single();
  check('(f) .single() on zero rows: error PGRST116, data null', r.error?.code === 'PGRST116' && r.data === null, JSON.stringify(r.error));
  note(`(f) .single() zero rows -> code ${r.error?.code}, status ${r.status}, message "${r.error?.message}"`);
  r = await database.from('users').select('id').eq('id', 999999999).maybeSingle();
  check('(f) .maybeSingle() on zero rows: data null, no error', r.data === null && r.error === null, JSON.stringify(r));
  r = await database.from('users').select('id').eq('id', sampleId).maybeSingle();
  check('(f) .maybeSingle() on one row: the object', r.data?.id === sampleId && r.error === null, JSON.stringify(r));
  r = await database.from('events').select('id').maybeSingle();
  check('(f) .maybeSingle() on many rows is an error (PGRST116)', r.error?.code === 'PGRST116', JSON.stringify(r.error));
  r = await database.from('users').select('id').eq('id', sampleId).single();
  check('(f) .single() on one row', r.data?.id === sampleId, JSON.stringify(r));

  const scratch = await database.from('permitted_urls').insert([{ url: `https://e2e-${RUN}.example/d1` }, { url: `https://e2e-${RUN}.example/d2` }]).select('id');
  const scratchIds = (scratch.data ?? []).map((row) => row.id);
  track.permittedUrls.push(...scratchIds);
  r = await database.from('permitted_urls').update({ url: `https://e2e-${RUN}.example/d1b` }).eq('id', scratchIds[0]).select('id, url');
  check('(d) update().select() returns the affected rows', Array.isArray(r.data) && r.data.length === 1 && r.data[0].url.endsWith('d1b'), JSON.stringify(r));
  r = await database.from('permitted_urls').update({ url: 'https://never.example' }).eq('id', 999999999).select('id');
  check('(d) update().select() with no match: empty array, no error', Array.isArray(r.data) && r.data.length === 0 && r.error === null, JSON.stringify(r));
  r = await database.from('permitted_urls').delete().in('id', scratchIds).select('id');
  check('(d) delete().select() returns the deleted rows', Array.isArray(r.data) && r.data.length === 2, JSON.stringify(r));
  r = await database.from('permitted_urls').delete().in('id', scratchIds).select('id');
  check('(d) delete().select() with no match: empty array, no error', Array.isArray(r.data) && r.data.length === 0 && r.error === null, JSON.stringify(r));
  r = await database.from('permitted_urls').delete().eq('id', 999999999);
  check('(d) delete() without select() has data null', r.data === null && r.error === null && r.status === 204, JSON.stringify(r));

  // supabase caps a response at its max rows setting unless a range is asked for
  const bulk = await database.from('permitted_urls').insert(Array.from({ length: 1100 }, (_, i) => ({ url: `https://e2e-${RUN}.example/bulk-${i}` }))).select('id');
  note(`(h) inserted ${bulk.data?.length} rows in one call (insert().select() returns them all: ${bulk.data?.length === 1100})`);
  const capped = await database.from('permitted_urls').select('id').like('url', `https://e2e-${RUN}.example/bulk-%`);
  note(`(h) select without limit over 1100 matching rows returned ${capped.data?.length}`);
  const ranged = await database.from('permitted_urls').select('id', { count: 'exact', head: true }).like('url', `https://e2e-${RUN}.example/bulk-%`);
  note(`(h) exact count of the same rows: ${ranged.count}`);

  // (e) in() lists
  const sizes = [100, 500, 1000, 1200, 1400, 1600, 1800, 2000, 4000];
  const inResults: string[] = [];
  let maxOk = 0;
  for (const size of sizes) {
    const ids = Array.from({ length: size }, (_, i) => 1000000 + i);
    const out: any = await database.from('users').select('id').in('id', ids);
    inResults.push(`${size}:${out.error ? `ERR ${out.status} ${String(out.error.message).slice(0, 60)}` : 'ok'}`);
    if (!out.error) maxOk = size;
  }
  note(`(e) .in() of 7 digit ids, list size -> ${inResults.join(' | ')}`);
  check('(e) .in() works for the sizes the services use (500 attempts, 1000 incidents)', maxOk >= 1000, inResults.join(' | '));
  const many = await database.from('users').select('id').in('id', [...Array.from({ length: 1000 }, (_, i) => 5000000 + i), stu1.id, stu2.id]);
  check('(e) .in() with 1000 ids still finds the 2 real rows', !many.error && many.data?.length === 2, JSON.stringify(many.error));

  check('no response leaked a password, a jwt, or is_correct to a student', leaks.length === 0, leaks.join(' | '));

  // ---------- logout ----------
  res = await P.post('/api/auth/logout');
  status('logout', res, 200);
  check('logout clears the jwt cookie', !P.jar.has('jwt') && res.cookies.some((line) => line.startsWith('jwt=;')), JSON.stringify(res.cookies));
  res = await P.get('/api/auth/get-user');
  status('get-user after logout', res, 401);
  const replay = new Client('replay');
  replay.jar.set('jwt', [...P.seen][0]);
  res = await replay.get('/api/auth/get-user');
  note(`known rough edge: the jwt of the logged out professor still authenticates after logout -> ${res.status}`);
  res = await login(prof);
  status('login again after logout', res, 200);
};

const main = async () => {
  let flowError: unknown = null;
  try {
    await flow();
  } catch (error) {
    flowError = error;
    check('the flow ran to its end', false, error instanceof Error ? error.stack : error);
  } finally {
    await stopServer();
    let errors: string[] = [];
    try {
      errors = await cleanup();
    } catch (error) {
      errors.push(`cleanup crashed: ${error instanceof Error ? error.message : error}`);
    }
    check('cleanup: no delete errors', errors.length === 0, errors.join(' | '));

    const counts = tableCounts();
    if (!counts) check('table counts through psql', false, 'psql failed or DATABASE_DIRECT_URL missing');
    else {
      const keep: Record<string, number> = { email_rules: 4, events: 13 };
      const dirty = Object.entries(counts).filter(([table, count]) => count !== (keep[table] ?? 0));
      console.log(`tables: ${Object.keys(counts).length}; email_rules=${counts.email_rules}, events=${counts.events}, tokens=${counts.tokens}, email_usage=${counts.email_usage}, email_logs=${counts.email_logs}`);
      check('every table is back to its seed count (all 0 except email_rules 4, events 13)', dirty.length === 0, dirty.map(([table, count]) => `${table}=${count}`).join(', '));
    }
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  for (const result of failed) console.log(`FAILED ${result.name} :: ${result.detail}`);
  if (failed.length || flowError) {
    console.log('--- server log (last 40 lines) ---');
    console.log(serverLog.slice(-40).join('\n'));
  }
  process.exit(failed.length ? 1 : 0);
};

main();
