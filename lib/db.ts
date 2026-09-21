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

export const database: SupabaseClient = createClient(databaseUrl, databaseKey, {
  global: { fetch: fetch },
  // @types/ws declares the constructor wider than the WebSocketLike one supabase-js asks for
  realtime: { transport: ws as unknown as Transport },
});
