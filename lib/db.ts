// The actual Postgres data lives directly in this project now (DATABASE_DIRECT_URL, same Railway
// project as the server - migrated off Supabase's Postgres to cut the cross-provider network hop
// on every query). `database.from(table)...` still works exactly as it did with supabase-js: see
// pg-query-builder.ts, which implements the subset of that query builder this codebase actually
// uses. Supabase itself is kept around for Storage only (DATABASE_URL/DATABASE_KEY below) - file
// uploads are a separate product from the Postgres data and weren't the latency problem.
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

// Railway's private network (*.railway.internal) is plain TCP, no TLS on the other end - asking
// for SSL there makes the handshake fail outright, not just skip chain verification like it does
// over the public proxy.
const isInternal = (url: string) => url.includes('localhost') || url.includes('127.0.0.1') || url.includes('.railway.internal');

const pool = new Pool({
  connectionString: postgresUrl,
  // Railway's internal Postgres (and most managed providers) terminate TLS with a cert chain
  // node's default CA list doesn't carry - this is the connection to our own project's database,
  // not a public endpoint, so skipping chain verification here is the standard tradeoff for it
  ssl: isInternal(postgresUrl) ? undefined : { rejectUnauthorized: false },
});

const storageClient: SupabaseClient = createClient(storageUrl, storageKey);

export const database = {
  from: (table: string) => new PgTable(pool, table),
  rpc: (name: string, params?: Record<string, unknown>) => rpc(pool, name, params),
  storage: storageClient.storage,
};
