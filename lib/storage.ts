// Uploads proctoring photos to the Supabase Storage bucket shared with the Rust desktop
// backend (`proctoring`, public-read) - see magi_app/backend/src/storage.rs for the same
// logic on that side.

import { database } from './db.js';
import { HttpError } from './errors.js';

const BUCKET = 'proctoring';
const MAX_BYTES = 5 * 1024 * 1024;
const PROFILE_PHOTO_MAX_BYTES = 3 * 1024 * 1024;

const SUBMISSIONS_BUCKET = 'submissions';
// base64 inflates by ~4/3 and server.ts caps the JSON body at 10mb, so the decoded file has to
// stay comfortably under that
const SUBMISSION_MAX_BYTES = 7 * 1024 * 1024;

/** Strips a `data:image/...;base64,...` prefix if present and returns the raw bytes + mime type. */
export const decodeImageData = (value: unknown): { bytes: Buffer; mime: string; ext: string } => {
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
  const { bytes, mime, ext } = decodeImageData(image);
  const path = `${attemptId}/${kind}/${randomSuffix()}.${ext}`;

  const { error } = await database.storage.from(BUCKET).upload(path, bytes, { contentType: mime });
  if (error) throw new Error(`photo upload failed: ${error.message}`);

  return database.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
};

/** Uploads a student's own reference photo under `profiles/{userId}/{random}.{ext}`. */
export const uploadProfilePhoto = async (userId: number, image: unknown): Promise<string> => {
  const { bytes, mime, ext } = decodeImageData(image);
  if (bytes.length > PROFILE_PHOTO_MAX_BYTES) throw new HttpError(400, 'invalid photo: must be at most 3MB');
  const path = `profiles/${userId}/${randomSuffix()}.${ext}`;

  const { error } = await database.storage.from(BUCKET).upload(path, bytes, { contentType: mime });
  if (error) throw new Error(`photo upload failed: ${error.message}`);

  return database.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
};

const sanitizeFileName = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'fileName is required');
  const base = value.trim().split(/[\\/]/).pop() ?? value.trim();
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
};

/** Strips a `data:<mime>;base64,...` prefix if present and returns the raw bytes + mime type. */
const decodeFileData = (value: unknown): { bytes: Buffer; mime: string } => {
  if (typeof value !== 'string' || !value) throw new HttpError(400, 'fileData is required');

  const match = value.match(/^data:([^;]+);base64,([\s\S]*)$/);
  const mime = match?.[1] ?? 'application/octet-stream';

  let bytes: Buffer;
  try {
    bytes = Buffer.from(match ? match[2] : value, 'base64');
  } catch {
    throw new HttpError(400, 'fileData must be valid base64');
  }
  if (!bytes.length) throw new HttpError(400, 'fileData is required');
  if (bytes.length > SUBMISSION_MAX_BYTES) throw new HttpError(400, 'file must be at most 20MB');

  return { bytes, mime };
};

/** Uploads a student's homework/exam file answer under `{attemptId}/{questionId}/{random}-{fileName}`. */
export const uploadSubmissionFile = async (
  attemptId: number,
  questionId: number,
  fileName: unknown,
  fileData: unknown
): Promise<string> => {
  const safeName = sanitizeFileName(fileName);
  const { bytes, mime } = decodeFileData(fileData);
  const path = `${attemptId}/${questionId}/${randomSuffix()}-${safeName}`;

  const { error } = await database.storage.from(SUBMISSIONS_BUCKET).upload(path, bytes, { contentType: mime });
  if (error) throw new Error(`file upload failed: ${error.message}`);

  return database.storage.from(SUBMISSIONS_BUCKET).getPublicUrl(path).data.publicUrl;
};
