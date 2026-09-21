import { envError } from './env.js';

// imported by server.ts only, right after dotenv and before every other import (db.ts and email.config.ts throw while those load)
const error = envError();

if (error) {
  console.error(error);
  process.exit(1);
};
