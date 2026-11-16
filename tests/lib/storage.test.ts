import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upload, getPublicUrl } = vi.hoisted(() => ({
  upload: vi.fn(),
  getPublicUrl: vi.fn(),
}));

vi.mock('../../lib/db.js', () => ({
  database: { storage: { from: () => ({ upload, getPublicUrl }) } },
}));

import { uploadAudio, uploadPhoto } from '../../lib/storage.js';
import { HttpError } from '../../lib/errors.js';

const rejected = async (promise: Promise<unknown>): Promise<any> => promise.then(() => null, (error) => error);

const ONE_PIXEL_JPEG = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

beforeEach(() => {
  upload.mockReset().mockResolvedValue({ data: { path: 'x' }, error: null });
  getPublicUrl.mockReset().mockReturnValue({ data: { publicUrl: 'https://supabase.test/proctoring/7/snapshots/x.jpg' } });
});

describe('uploadPhoto', () => {
  it('decodes a data url, uploads it, and returns the public url', async () => {
    const url = await uploadPhoto(7, 'snapshots', `data:image/jpeg;base64,${ONE_PIXEL_JPEG}`);

    expect(url).toBe('https://supabase.test/proctoring/7/snapshots/x.jpg');
    const [path, bytes, options] = upload.mock.calls[0];
    expect(path).toMatch(/^7\/snapshots\/.+\.jpg$/);
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(options).toEqual({ contentType: 'image/jpeg' });
  });

  it('accepts bare base64 (no data url prefix) as jpeg', async () => {
    await uploadPhoto(7, 'snapshots', ONE_PIXEL_JPEG);
    expect(upload.mock.calls[0][2]).toEqual({ contentType: 'image/jpeg' });
  });

  it('recognizes a png data url and uses the .png extension', async () => {
    await uploadPhoto(7, 'face-snapshots', `data:image/png;base64,${ONE_PIXEL_JPEG}`);

    expect(upload.mock.calls[0][0]).toMatch(/\.png$/);
    expect(upload.mock.calls[0][2]).toEqual({ contentType: 'image/png' });
  });

  it('400s on a missing image', async () => {
    for (const image of [undefined, '', 42, null]) {
      const error = await rejected(uploadPhoto(7, 'snapshots', image));
      expect(error).toBeInstanceOf(HttpError);
      expect(error.status).toBe(400);
    }
    expect(upload).not.toHaveBeenCalled();
  });

  it('400s on an image over 5MB once decoded', async () => {
    const huge = Buffer.alloc(6 * 1024 * 1024).toString('base64');
    const error = await rejected(uploadPhoto(7, 'snapshots', huge));

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it('turns a storage upload failure into a plain error', async () => {
    upload.mockResolvedValue({ data: null, error: { message: 'bucket not found' } });

    const error = await rejected(uploadPhoto(7, 'snapshots', ONE_PIXEL_JPEG));

    expect(error).not.toBeInstanceOf(HttpError);
    expect(error.message).toContain('bucket not found');
  });
});

describe('uploadAudio', () => {
  const ONE_FRAME_WEBM = 'GkXfo0AgQoaBAU';

  it('decodes a data url, uploads it, and returns the public url', async () => {
    getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://supabase.test/proctoring/7/audio-recordings/x.webm' } });

    const url = await uploadAudio(7, 'audio-recordings', `data:audio/webm;base64,${ONE_FRAME_WEBM}`);

    expect(url).toBe('https://supabase.test/proctoring/7/audio-recordings/x.webm');
    const [path, bytes, options] = upload.mock.calls[0];
    expect(path).toMatch(/^7\/audio-recordings\/.+\.webm$/);
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(options).toEqual({ contentType: 'audio/webm' });
  });

  it('takes the codecs parameter the desktop app recorder adds', async () => {
    getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://supabase.test/proctoring/7/audio-recordings/x.webm' } });

    await uploadAudio(7, 'audio-recordings', `data:audio/webm;codecs=opus;base64,${ONE_FRAME_WEBM}`);

    const [path, , options] = upload.mock.calls[0];
    expect(path).toMatch(/\.webm$/);
    expect(options).toEqual({ contentType: 'audio/webm' });
  });

  it('400s without a data:audio/...;base64,... prefix', async () => {
    for (const audio of [undefined, '', 42, null, ONE_FRAME_WEBM, 'data:image/jpeg;base64,AAA']) {
      const error = await rejected(uploadAudio(7, 'audio-recordings', audio));
      expect(error).toBeInstanceOf(HttpError);
      expect(error.status).toBe(400);
    }
    expect(upload).not.toHaveBeenCalled();
  });

  it('400s on audio over 8MB once decoded', async () => {
    const huge = Buffer.alloc(9 * 1024 * 1024).toString('base64');
    const error = await rejected(uploadAudio(7, 'audio-recordings', `data:audio/webm;base64,${huge}`));

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it('turns a storage upload failure into a plain error', async () => {
    upload.mockResolvedValue({ data: null, error: { message: 'bucket not found' } });

    const error = await rejected(uploadAudio(7, 'audio-recordings', `data:audio/webm;base64,${ONE_FRAME_WEBM}`));

    expect(error).not.toBeInstanceOf(HttpError);
    expect(error.message).toContain('bucket not found');
  });
});
