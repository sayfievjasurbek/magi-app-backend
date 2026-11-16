import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// railway postgres (DATABASE_URL is only supabase storage now)
const url = process.env.DATABASE_DIRECT_URL;
if (!url) throw new Error('DATABASE_DIRECT_URL is not set');

const dir = new URL('../migrations/', import.meta.url);
const files = readdirSync(dir).filter((file) => file.endsWith('.sql')).sort();

for (const file of files) {
  console.log(`Applying ${file}`);
  // fileURLToPath, not .pathname: a project path containing a space would stay percent encoded
  execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q', '-f', fileURLToPath(new URL(file, dir))], { stdio: 'inherit' });
}

console.log(`Applied ${files.length} migrations`);
