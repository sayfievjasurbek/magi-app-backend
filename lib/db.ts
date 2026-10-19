import { createClient, SupabaseClient, type SupabaseClientOptions } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import ws from 'ws';


dotenv.config();

type Transport = NonNullable<NonNullable<SupabaseClientOptions<'public'>['realtime']>['transport']>;

const databaseUrl = process.env.DATABASE_URL;
const databaseKey = process.env.DATABASE_KEY;

if (!databaseUrl || !databaseKey) {
  throw new Error(
    'Database is not configured. Set DATABASE_URL and DATABASE_KEY in your environment.'
  );
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 300;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A transient network blip or a momentary 502/503/504 from Supabase used to surface straight to
// the end user as a 500 on the very next request. Retried here only for reads (GET) - a write
// (POST/PATCH/DELETE) whose response was merely lost in transit is not safe to retry blindly,
// since the original may already have gone through and a retry would duplicate it.
const fetchWithRetry: typeof fetch = async (input, init) => {
  if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return fetch(input, init);

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(input, init);
      if (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_RETRIES) return response;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
    }
    await sleep(RETRY_DELAY_MS * (attempt + 1));
  }
};

export const database: SupabaseClient = createClient(databaseUrl, databaseKey, {
  global: { fetch: fetchWithRetry },
  // @types/ws declares the constructor wider than the WebSocketLike one supabase-js asks for
  realtime: { transport: ws as unknown as Transport },
});
