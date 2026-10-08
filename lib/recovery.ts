import crypto from 'crypto';

// Admin-created student accounts keep a recoverable copy of their password, so a professor can
// look it up when a student forgets it (their own deliberate call - most accounts, created via
// self-signup, have no recovery_secret at all and aren't affected). Encrypted at rest with a key
// derived from JWT_SECRET rather than stored as plain text, so a database leak alone isn't enough.
const key = () => crypto.createHash('sha256').update(process.env.JWT_SECRET as string).digest();

export const encryptSecret = (plain: string): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
};

export const decryptSecret = (stored: string): string => {
  const raw = Buffer.from(stored, 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
};
