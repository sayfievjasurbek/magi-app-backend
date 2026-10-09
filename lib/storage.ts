// Uploads proctoring photos to the Supabase Storage bucket shared with the Rust desktop
// backend (`proctoring`, public-read) - see magi_app/backend/src/storage.rs for the same
// logic on that side.

import { database } from './db.js';
import { HttpError } from './errors.js';

const BUCKET = 'proctoring';
const MAX_BYTES = 5 * 1024 * 1024;

/** Strips a `data:image/...;base64,...` prefix if present and returns the raw bytes + mime type. */
const decode = (value: unknown): { bytes: Buffer; mime: string; ext: string } => {
  if (typeof value !== 'string' || !value) throw new HttpError(400, 'image is required');

  let mime = 'image/jpeg';
  let ext = 'jpg';
  let raw = value;
  if (value.startsWith('data:image/png;base64,')) {
    mime = 'image/png';
    ext = 'png';
    raw = value.slice('data:image/png;base64,'.length);
  } else if (value.startsWith('data:image/jpeg;base64,')) {
    raw = value.slice('data:image/jpeg;base64,'.length);
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(raw, 'base64');
  } catch {
    throw new HttpError(400, 'image must be valid base64');
  }
  if (!bytes.length) throw new HttpError(400, 'image is required');
  if (bytes.length > MAX_BYTES) throw new HttpError(400, 'image must be at most 5MB');

  return { bytes, mime, ext };
};

const randomSuffix = () => `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;

/** Uploads one photo under `{attemptId}/{kind}/{random}.{ext}` and returns its public URL. */
export const uploadPhoto = async (attemptId: number, kind: string, image: unknown): Promise<string> => {
  const { bytes, mime, ext } = decode(image);
  const path = `${attemptId}/${kind}/${randomSuffix()}.${ext}`;

  const { error } = await database.storage.from(BUCKET).upload(path, bytes, { contentType: mime });
  if (error) throw new Error(`photo upload failed: ${error.message}`);

  return database.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
};

/** Uploads a student's own reference photo under `profiles/{userId}/{random}.{ext}`. */
export const uploadProfilePhoto = async (userId: number, image: unknown): Promise<string> => {
  const { bytes, mime, ext } = decode(image);
  const path = `profiles/${userId}/${randomSuffix()}.${ext}`;

  const { error } = await database.storage.from(BUCKET).upload(path, bytes, { contentType: mime });
  if (error) throw new Error(`photo upload failed: ${error.message}`);

  return database.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
};
