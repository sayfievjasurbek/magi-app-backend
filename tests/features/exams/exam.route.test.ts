import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { type Role } from '../../../lib/types.js';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'exam-route-test-secret';
});

// the fake answers every query with nothing, so a service that is reached stops at its first lookup;
// 'tokens' is special-cased so protectRoute's session-revocation check finds a live, unrevoked session
vi.mock('../../../lib/db.js', () => {
  const makeBuilder = (resolved: unknown) => {
    const builder: any = { then: (resolve: (value: unknown) => unknown) => resolve(resolved) };
    for (const method of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'is', 'order', 'limit', 'maybeSingle', 'single']) {
      builder[method] = () => builder;
    };
    return builder;
  };
  const emptyBuilder = makeBuilder({ data: null, error: null });
  const sessionBuilder = makeBuilder({ data: { revoked: false }, error: null });
  return { database: { from: (table: string) => (table === 'tokens' ? sessionBuilder : emptyBuilder) } };
});

import examRoutes from '../../../features/exams/exam.route.js';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/exams', examRoutes);

let server: Server;
let base: string;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/exams`;
});

afterAll(() => new Promise((resolve) => server.close(() => resolve(null))));

const cookie = (role: Role) =>
  `jwt=${jwt.sign({ id: 7, first_name: 'Test', last_name: null, email: 'test@magi', role }, process.env.JWT_SECRET as string, { expiresIn: '1h' })}`;

const call = (method: string, path: string, role: Role | null, body?: object) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(role ? { cookie: cookie(role) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('exam routes', () => {
  it('401s without the cookie', async () => {
    const response = await call('GET', '/', null);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ success: false });
  });

  it('403s a student that tries to create an exam', async () => {
    const response = await call('POST', '/', 'student', { name: 'Mine' });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, message: 'Only professors can access this resource' });
  });

  it('403s an examiner that tries to add a question', async () => {
    const response = await call('POST', '/1/questions', 'examiner', { questionId: 11 });

    expect(response.status).toBe(403);
  });

  it('keeps the event catalog to the staff, and ahead of /:examId', async () => {
    const response = await call('GET', '/events', 'student');

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, message: 'Only professors or examiners can access this resource' });
  });

  it('400s a professor that creates an exam without a name', async () => {
    const response = await call('POST', '/', 'professor', { scheduledStart: '2026-01-10T09:00:00Z', scheduledEnd: '2026-01-10T11:00:00Z' });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, message: 'name is required and must be at most 100 characters' });
  });

  it('400s a professor that sends no body at all', async () => {
    const response = await fetch(`${base}/`, { method: 'POST', headers: { cookie: cookie('professor') } });

    expect(response.status).toBe(400);
  });

  it('400s a status that is not in the enum', async () => {
    const response = await call('PATCH', '/1/status', 'professor', { status: 'paused' });

    expect(response.status).toBe(400);
  });

  it('404s a path id that cannot be an id', async () => {
    const response = await call('DELETE', '/abc', 'professor', { reason: 'wrong exam' });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, message: 'Exam not found' });
  });

  // a nested id that is read from the wrong parameter would answer 'Module not found' here too
  it('reads the nested ids from their own parameters', async () => {
    const bad = await call('DELETE', '/1/modules/abc', 'professor');
    const good = await call('DELETE', '/1/modules/2', 'professor');

    expect(await bad.json()).toEqual({ success: false, message: 'Module not found' });
    expect(await good.json()).toEqual({ success: false, message: 'Exam not found' });
  });

  it('reads the permitted url id from its own parameter', async () => {
    const bad = await call('DELETE', '/1/permitted-urls/abc', 'professor');
    const good = await call('DELETE', '/1/permitted-urls/2', 'professor');

    expect(await bad.json()).toEqual({ success: false, message: 'Permitted url not found' });
    expect(await good.json()).toEqual({ success: false, message: 'Exam not found' });
  });

  it('reads the permitted app id from its own parameter', async () => {
    const bad = await call('DELETE', '/1/permitted-apps/abc', 'professor');
    const good = await call('DELETE', '/1/permitted-apps/2', 'professor');

    expect(await bad.json()).toEqual({ success: false, message: 'Permitted app not found' });
    expect(await good.json()).toEqual({ success: false, message: 'Exam not found' });
  });
});
