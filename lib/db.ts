// postgres on railway now. pg-query-builder mimics the supabase-js api so
// database.from(...) works the same. supabase is only used for storage
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { PgTable, rpc } from './pg-query-builder.js';

dotenv.config();

const postgresUrl = process.env.DATABASE_DIRECT_URL;
if (!postgresUrl) {
  throw new Error('Database is not configured. Set DATABASE_DIRECT_URL in your environment.');
}

const storageUrl = process.env.DATABASE_URL;
const storageKey = process.env.DATABASE_KEY;
if (!storageUrl || !storageKey) {
  throw new Error('Storage is not configured. Set DATABASE_URL and DATABASE_KEY in your environment.');
}

// railway private network has no tls
const isInternal = (url: string) => url.includes('localhost') || url.includes('127.0.0.1') || url.includes('.railway.internal');

const pool = new Pool({
  connectionString: postgresUrl,
  // our own db, the cert chain isn't in node's ca list
  ssl: isInternal(postgresUrl) ? undefined : { rejectUnauthorized: false },
});

const storageClient: SupabaseClient = createClient(storageUrl, storageKey);

export const database = {
  from: (table: string) => new PgTable(pool, table),
  rpc: (name: string, params?: Record<string, unknown>) => rpc(pool, name, params),
  storage: storageClient.storage,
};
