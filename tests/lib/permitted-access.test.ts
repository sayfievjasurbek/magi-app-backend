import { describe, it, expect, vi, beforeEach } from 'vitest';

// one chainable fake for the whole client: every awaited call takes the next queued { data, error }
const { from, results } = vi.hoisted(() => {
  const results: { data: unknown; error: unknown }[] = [];
  const take = () => results.shift() ?? { data: null, error: null };
  const builder: Record<string, any> = {
    single: vi.fn(() => Promise.resolve(take())),
    maybeSingle: vi.fn(() => Promise.resolve(take())),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(take()).then(resolve),
  };
  for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'limit']) {
    builder[method] = vi.fn(() => builder);
  };
  const from = vi.fn(() => builder);
  return { from, results };
});

vi.mock('../../lib/db.js', () => ({ database: { from } }));

import {
  requireUrl,
  requireAppName,
  findOrCreatePermittedUrl,
  findOrCreatePermittedApp,
  linkPermitted,
  unlinkPermitted,
  sharedModuleIds,
  effectivePermittedUrls,
  effectivePermittedApps,
} from '../../lib/permitted-access.js';
import { HttpError } from '../../lib/errors.js';

const ok = (data: unknown) => ({ data, error: null });
const fail = (error: unknown) => ({ data: null, error });
const queue = (...items: { data: unknown; error: unknown }[]) => results.push(...items);

beforeEach(() => {
  results.length = 0;
  vi.clearAllMocks();
});

describe('requireUrl', () => {
  it('accepts an http(s) address', () => {
    expect(requireUrl(' https://docs.python.org/3/ ')).toBe('https://docs.python.org/3/');
  });

  it('rejects anything else', () => {
    expect(() => requireUrl('not a url')).toThrow(HttpError);
    expect(() => requireUrl('ftp://files.example.com')).toThrow(HttpError);
    expect(() => requireUrl(undefined)).toThrow(HttpError);
  });
});

describe('requireAppName', () => {
  it('trims and accepts a non-empty name', () => {
    expect(requireAppName('  Visual Studio Code  ')).toBe('Visual Studio Code');
  });

  it('rejects an empty or missing name', () => {
    expect(() => requireAppName('   ')).toThrow(HttpError);
    expect(() => requireAppName(undefined)).toThrow(HttpError);
  });
});

describe('findOrCreatePermittedUrl / findOrCreatePermittedApp', () => {
  it('reuses an existing url instead of creating a duplicate', async () => {
    queue(ok([{ id: 4, url: 'https://docs.magi' }]));

    expect(await findOrCreatePermittedUrl('https://docs.magi')).toEqual({ id: 4, url: 'https://docs.magi' });
    expect(from).toHaveBeenCalledWith('permitted_urls');
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('creates a new row when the url is not stored yet', async () => {
    queue(ok([]), ok({ id: 9, url: 'https://new.example' }));

    expect(await findOrCreatePermittedUrl('https://new.example')).toEqual({ id: 9, url: 'https://new.example' });
  });

  it('does the same for apps, against permitted_apps', async () => {
    queue(ok([]), ok({ id: 2, name: 'Visual Studio Code' }));

    expect(await findOrCreatePermittedApp('Visual Studio Code')).toEqual({ id: 2, name: 'Visual Studio Code' });
    expect(from).toHaveBeenCalledWith('permitted_apps');
  });
});

describe('linkPermitted / unlinkPermitted', () => {
  it('inserts the link', async () => {
    queue(ok(null));

    await linkPermitted('exam_permitted_url', 'exam_id', 1, 'permitted_url_id', 4, 'already permitted');
    expect(from).toHaveBeenCalledWith('exam_permitted_url');
  });

  it('maps a duplicate-key error to the given conflict message', async () => {
    queue(fail({ code: '23505', message: 'duplicate key' }));

    await expect(linkPermitted('exam_permitted_url', 'exam_id', 1, 'permitted_url_id', 4, 'The url is already permitted for this exam'))
      .rejects.toMatchObject({ status: 409, message: 'The url is already permitted for this exam' });
  });

  it('404s when there was nothing to remove', async () => {
    queue(ok([]));

    await expect(unlinkPermitted('exam_permitted_url', 'exam_id', 1, 'permitted_url_id', 4, 'Permitted url not found'))
      .rejects.toMatchObject({ status: 404, message: 'Permitted url not found' });
  });

  it('removes the link when it exists', async () => {
    queue(ok([{ permitted_url_id: 4 }]));

    await expect(unlinkPermitted('exam_permitted_url', 'exam_id', 1, 'permitted_url_id', 4, 'Permitted url not found')).resolves.toBeUndefined();
  });
});

describe('sharedModuleIds', () => {
  it('keeps only modules the student is in that the exam is also linked to', async () => {
    queue(
      ok([{ module_id: 1 }, { module_id: 2 }]), // module_student
      ok([{ module_id: 2 }, { module_id: 3 }]) // exam_module
    );

    expect(await sharedModuleIds(5, 9)).toEqual([2]);
  });

  it('is empty when the student and the exam share no module', async () => {
    queue(ok([{ module_id: 1 }]), ok([{ module_id: 2 }]));

    expect(await sharedModuleIds(5, 9)).toEqual([]);
  });
});

describe('effectivePermittedUrls / effectivePermittedApps', () => {
  it('merges the exam, the student and a shared module, deduplicating a url granted twice', async () => {
    queue(
      ok([{ permitted_url_id: 4 }]), // exam_permitted_url
      ok([{ permitted_url_id: 5 }]), // student_permitted_url
      ok([{ permitted_url_id: 4 }, { permitted_url_id: 6 }]), // module_permitted_url, for the one shared module
      ok([{ id: 4, url: 'a' }, { id: 5, url: 'b' }, { id: 6, url: 'c' }]) // permitted_urls
    );

    expect(await effectivePermittedUrls(1, 9, [2])).toEqual([{ id: 4, url: 'a' }, { id: 5, url: 'b' }, { id: 6, url: 'c' }]);
  });

  it('skips the module lookup entirely when no module is shared', async () => {
    queue(ok([{ permitted_url_id: 4 }]), ok([]), ok([{ id: 4, url: 'a' }]));

    expect(await effectivePermittedUrls(1, 9, [])).toEqual([{ id: 4, url: 'a' }]);
    expect(from).not.toHaveBeenCalledWith('module_permitted_url');
  });

  it('answers empty without even querying permitted_urls when nothing is granted', async () => {
    queue(ok([]), ok([]));

    expect(await effectivePermittedUrls(1, 9, [])).toEqual([]);
    expect(from).not.toHaveBeenCalledWith('permitted_urls');
  });

  it('does the same merge for apps, against the app tables', async () => {
    queue(ok([{ permitted_app_id: 2 }]), ok([]), ok([{ id: 2, name: 'Visual Studio Code' }]));

    expect(await effectivePermittedApps(1, 9, [])).toEqual([{ id: 2, name: 'Visual Studio Code' }]);
    expect(from).toHaveBeenCalledWith('exam_permitted_app');
    expect(from).toHaveBeenCalledWith('permitted_apps');
  });
});
