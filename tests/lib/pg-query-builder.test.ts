// runs against a real postgres (TEST_DATABASE_URL, default localhost:5440):
// docker run --rm -d -e POSTGRES_PASSWORD=testpass -e POSTGRES_DB=magitest -p 5440:5432 postgres:16
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { PgTable, rpc } from '../../lib/pg-query-builder.js';

const connectionString = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:testpass@localhost:5440/magitest';
const pool = new Pool({ connectionString });
const table = () => new PgTable<any>(pool, 'pgqb_test');

beforeAll(async () => {
  await pool.query(`
    drop function if exists pgqb_test_sum(int, int);
    drop function if exists pgqb_test_insert_row(text);
    drop table if exists pgqb_test cascade;
    create table pgqb_test (
      id bigint generated always as identity primary key,
      name text not null,
      code text unique,
      score int,
      active boolean not null default true
    );
    drop function if exists pgqb_test_sum(int, int);
    create function pgqb_test_sum(param_a int, param_b int) returns int language sql as $$ select param_a + param_b $$;
    -- mirrors start_attempt's actual shape: returns json, not a composite row type, which matters
    -- for rpc()'s unwrap rule (SELECT * FROM a json-returning fn is still just 1 row x 1 column)
    drop function if exists pgqb_test_insert_row(text);
    create function pgqb_test_insert_row(param_name text) returns json language sql as $$
      with inserted as (insert into pgqb_test (name) values (param_name) returning *)
      select to_json(inserted) from inserted
    $$;
  `);
});

afterAll(async () => {
  await pool.query('drop function if exists pgqb_test_sum(int, int); drop function if exists pgqb_test_insert_row(text); drop table if exists pgqb_test cascade;');
  await pool.end();
});

beforeEach(async () => {
  await pool.query('truncate pgqb_test restart identity');
});

describe('bigint columns', () => {
  // pg returns bigint as a string by default, broke every id === check
  it('comes back as a real number, not a string', async () => {
    const { data } = await table().insert({ name: 'x' }).select().single();
    expect(typeof data.id).toBe('number');
    expect(Number.isInteger(data.id)).toBe(true);
  });
});

describe('select', () => {
  it('filters with eq, orders, and limits', async () => {
    await table().insert([{ name: 'a', score: 1 }, { name: 'b', score: 2 }, { name: 'c', score: 3 }]);

    const { data, error } = await table().select('*').eq('active', true).order('score', { ascending: false }).limit(2);

    expect(error).toBeNull();
    expect(data?.map((r: any) => r.name)).toEqual(['c', 'b']);
  });

  it('filters with neq, in, is, ilike, and like', async () => {
    await table().insert([
      { name: 'Apple', score: 1, active: true },
      { name: 'Banana', score: null, active: true },
      { name: 'Cherry', score: 3, active: false },
    ]);

    expect((await table().select('name').neq('name', 'Apple')).data?.map((r: any) => r.name).sort()).toEqual(['Banana', 'Cherry']);
    expect((await table().select('name').in('score', [1, 3])).data?.map((r: any) => r.name).sort()).toEqual(['Apple', 'Cherry']);
    expect((await table().select('name').in('score', [])).data).toEqual([]); // empty IN list matches nothing, like PostgREST
    expect((await table().select('name').is('score', null)).data?.map((r: any) => r.name)).toEqual(['Banana']);
    expect((await table().select('name').ilike('name', '%ERRY')).data?.map((r: any) => r.name)).toEqual(['Cherry']);
    expect((await table().select('name').like('name', '%ERRY')).data).toEqual([]); // case-sensitive, no match
    expect((await table().select('name').like('name', '%erry')).data?.map((r: any) => r.name)).toEqual(['Cherry']);
  });

  it('counts with head:true, returning no rows', async () => {
    await table().insert([{ name: 'a', active: true }, { name: 'b', active: true }, { name: 'c', active: false }]);

    const { data, error, count } = await table().select('id', { count: 'exact', head: true }).eq('active', true);

    expect(error).toBeNull();
    expect(data).toBeNull();
    expect(count).toBe(2);
  });
});

describe('single / maybeSingle', () => {
  it('single() resolves the one row', async () => {
    const { data: inserted } = await table().insert({ name: 'only' }).select().single();
    const { data, error } = await table().select('*').eq('id', inserted.id).single();
    expect(error).toBeNull();
    expect(data.name).toBe('only');
  });

  it('single() errors on zero or more than one row', async () => {
    expect((await table().select('*').eq('name', 'nobody').single()).error).not.toBeNull();
    await table().insert([{ name: 'x' }, { name: 'x' }]);
    expect((await table().select('*').eq('name', 'x').single()).error).not.toBeNull();
  });

  it('maybeSingle() returns null for zero rows, the row for one, and an error for more than one', async () => {
    expect((await table().select('*').eq('name', 'nobody').maybeSingle()).data).toBeNull();
    await table().insert({ name: 'y' });
    const one = await table().select('*').eq('name', 'y').maybeSingle();
    expect(one.data?.name).toBe('y');
    await table().insert({ name: 'y' });
    expect((await table().select('*').eq('name', 'y').maybeSingle()).error).not.toBeNull();
  });
});

describe('insert / update / upsert / delete', () => {
  it('insert returns the inserted row(s) via RETURNING even without an explicit .select()', async () => {
    const { data, error } = await table().insert({ name: 'inserted' });
    expect(error).toBeNull();
    expect(data![0].name).toBe('inserted');
  });

  it('insert accepts an array of rows', async () => {
    const { data } = await table().insert([{ name: 'a' }, { name: 'b' }]);
    expect(data!.map((r: any) => r.name).sort()).toEqual(['a', 'b']);
  });

  it('update sets columns and filters with eq, returning the updated row', async () => {
    const { data: row } = await table().insert({ name: 'before', score: 1 }).select().single();
    const { data, error } = await table().update({ name: 'after' }).eq('id', row.id).select().single();
    expect(error).toBeNull();
    expect(data.name).toBe('after');
    expect(data.score).toBe(1); // untouched column survives
  });

  it('upsert inserts on first call and updates on conflict', async () => {
    // conflict on a composite key, like attendance/exam_question do
    const first = await table().upsert({ name: 'v1', code: 'dup', score: 1 }, { onConflict: 'code' }).select().single();
    expect(first.data.score).toBe(1);
    const second = await table().upsert({ name: 'v2', code: 'dup', score: 2 }, { onConflict: 'code' }).select().single();
    expect(second.data.score).toBe(2);
    expect((await table().select('*').eq('code', 'dup')).data).toHaveLength(1); // still one row, not two
  });

  it('delete removes the matching row and returns it', async () => {
    const { data: row } = await table().insert({ name: 'gone' }).select().single();
    const { data, error } = await table().delete().eq('id', row.id).select().single();
    expect(error).toBeNull();
    expect(data.name).toBe('gone');
    expect((await table().select('*').eq('id', row.id)).data).toEqual([]);
  });

  it('turns a real constraint violation into a Postgres-coded error, not a thrown exception', async () => {
    const { error } = await table().insert({ id: null, name: 'bad' } as any);
    expect(error).not.toBeNull();
    expect(error?.code).toBeTruthy();
  });
});

describe('rpc', () => {
  it('unwraps a single-row single-column scalar result', async () => {
    const { data, error } = await rpc(pool, 'pgqb_test_sum', { param_a: 2, param_b: 3 });
    expect(error).toBeNull();
    expect(data).toBe(5);
  });

  it('unwraps a single-row composite (json-like) result to a plain object', async () => {
    const { data, error } = await rpc(pool, 'pgqb_test_insert_row', { param_name: 'via-rpc' });
    expect(error).toBeNull();
    expect(data.name).toBe('via-rpc');
    expect(typeof data.id).toBe('number');
  });

  it('returns an error for an unknown function instead of throwing', async () => {
    const { data, error } = await rpc(pool, 'pgqb_test_does_not_exist', {});
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });
});
