import { describe, it, expect, vi, afterEach } from 'vitest';
import { findGoogleDocLink, fetchGoogleDoc } from '../../lib/google-docs.js';

const rejected = async (promise: Promise<unknown>): Promise<any> => promise.then(() => null, (error) => error);

afterEach(() => vi.unstubAllGlobals());

describe('findGoogleDocLink', () => {
  it('finds a Google Docs link anywhere in the message', () => {
    expect(findGoogleDocLink('shu hujjatni ko\'r: https://docs.google.com/document/d/1AbC-23_xyz/edit?usp=sharing'))
      .toEqual({ kind: 'document', id: '1AbC-23_xyz' });
  });

  it('finds a Google Sheets link', () => {
    expect(findGoogleDocLink('https://docs.google.com/spreadsheets/d/1Sheet99/edit'))
      .toEqual({ kind: 'spreadsheets', id: '1Sheet99' });
  });

  it('finds a Google Slides link', () => {
    expect(findGoogleDocLink('https://docs.google.com/presentation/d/1Slides77/edit#slide=id.p'))
      .toEqual({ kind: 'presentation', id: '1Slides77' });
  });

  it('returns null when there is no Google Docs link', () => {
    expect(findGoogleDocLink('shunchaki oddiy xabar, hech qanday link yoq')).toBeNull();
    expect(findGoogleDocLink('https://example.com/document/d/123')).toBeNull();
  });
});

describe('fetchGoogleDoc', () => {
  it('downloads the exported file and names it by kind', async () => {
    const bytes = Buffer.from('fake docx bytes');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    }));

    const result = await fetchGoogleDoc('document', 'abc123');

    expect(globalThis.fetch).toHaveBeenCalledWith('https://docs.google.com/document/d/abc123/export?format=docx', { redirect: 'follow' });
    expect(result.name).toBe('google-doc.docx');
    expect(result.bytes.toString()).toBe('fake docx bytes');
  });

  it('400s when the document is not link-shared (Google answers with an HTML page instead)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html; charset=utf-8' },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }));

    const error = await rejected(fetchGoogleDoc('document', 'private-doc'));
    expect(error.status).toBe(400);
  });

  it('400s on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      headers: { get: () => 'text/html' },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }));

    const error = await rejected(fetchGoogleDoc('spreadsheets', 'gone'));
    expect(error.status).toBe(400);
  });

  it('400s when the exported file is over the size cap', async () => {
    const big = Buffer.alloc(7 * 1024 * 1024, 'a');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
      arrayBuffer: () => Promise.resolve(big.buffer.slice(big.byteOffset, big.byteOffset + big.byteLength)),
    }));

    const error = await rejected(fetchGoogleDoc('presentation', 'huge-deck'));
    expect(error.status).toBe(400);
  });
});
