import { envError } from './env.js';

// must be imported before db.ts/email.config.ts
const error = envError();

if (error) {
  console.error(error);
  process.exit(1);
};
