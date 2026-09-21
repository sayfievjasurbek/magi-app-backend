// db.ts and email.config.ts still throw for their own variables and stay as they are,
// this reports every problem at once instead of only the first import that fails

const REQUIRED = ['DATABASE_URL', 'DATABASE_KEY', 'JWT_SECRET', 'EMAIL_TOKEN', 'SENDER_EMAIL', 'CLIENT_URL'];
const PLACEHOLDER_SECRET = 'the_jwt_secret_is_empty_for_now';
const MIN_SECRET_LENGTH = 32;

// null when the environment is fine, else one message naming every problem (names only, never values)
export const envError = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const problems: string[] = [];

  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length) problems.push(`missing ${missing.join(', ')}`);

  const secret = env.JWT_SECRET;
  if (env.NODE_ENV === 'production' && secret?.trim()) {
    if (secret === PLACEHOLDER_SECRET) problems.push('JWT_SECRET is still the placeholder');
    else if (secret.length < MIN_SECRET_LENGTH) problems.push(`JWT_SECRET is shorter than ${MIN_SECRET_LENGTH} characters`);
  };

  return problems.length ? `Invalid environment, the server did not start: ${problems.join('; ')}` : null;
};
