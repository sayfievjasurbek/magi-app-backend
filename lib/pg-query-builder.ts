// A small stand-in for supabase-js's query builder, backed directly by Postgres instead of
// PostgREST over HTTP - implements exactly the chainable surface this codebase actually uses
// (grepped across features/ and lib/: select/insert/update/upsert/delete, eq/neq/in/is/ilike,
// order/limit, single/maybeSingle, the count+head pattern, and awaiting the builder directly),
// nothing more. Every feature file keeps calling `database.from(table)...` exactly as before.

import type { Pool } from 'pg';

export type PgError = { message: string; code?: string };
// a discriminated union, matching supabase-js's own PostgrestResponse shape: once `error` has
// been checked and ruled out, `data` narrows to non-null without an extra null check - this is
// why `.single()` call sites across the codebase use `data.whatever` straight after `if (error) throw`
export type PgResult<T> = { data: T; error: null; count?: number } | { data: null; error: PgError; count?: number };
// supabase-js types a plain select's `data` as `Row[]` (not a bare `any`), which matters:
// `(data ?? []).map(...)` only infers the callback param without an explicit annotation when
// `data` is an array type - a bare `any` makes `any ?? []` fail to do that. `.single()` switches
// the shape to one (non-null) row instead, same as the real client.
type ManyOrOne<T, Mode extends 'many' | 'one'> = Mode extends 'one' ? T : T[];

type FilterOp = 'eq' | 'neq' | 'in' | 'is' | 'ilike' | 'like';
interface Filter {
  col: string;
  op: FilterOp;
  val: unknown;
}

type Action =
  | { kind: 'select'; columns: string; count?: 'exact'; head?: boolean }
  | { kind: 'insert'; rows: Record<string, unknown>[] }
  | { kind: 'update'; patch: Record<string, unknown> }
  | { kind: 'upsert'; rows: Record<string, unknown>[]; onConflict?: string }
  | { kind: 'delete' };

const quote = (ident: string) => `"${ident}"`;

export class PgTable<T = any, Mode extends 'many' | 'one' = 'many'> implements PromiseLike<PgResult<ManyOrOne<T, Mode>>> {
  private filters: Filter[] = [];
  private action: Action = { kind: 'select', columns: '*' };
  // once a mutation verb is set, a later `.select(cols)` means "RETURNING these columns", not
  // "run a separate SELECT instead" - the common `.insert(x).select('cols').single()` chain
  private verbSet = false;
  private returningColumns = '*';
  private orderBy: { col: string; ascending: boolean }[] = [];
  private limitN: number | null = null;
  private wantSingle: 'single' | 'maybeSingle' | null = null;

  constructor(private pool: Pool, private table: string) {}

  select(columns = '*', opts?: { count?: 'exact'; head?: boolean }): this {
    if (this.verbSet) {
      this.returningColumns = columns;
    } else {
      this.action = { kind: 'select', columns, count: opts?.count, head: opts?.head };
    }
    return this;
  }

  insert(rows: Record<string, unknown> | Record<string, unknown>[]): this {
    this.action = { kind: 'insert', rows: Array.isArray(rows) ? rows : [rows] };
    this.verbSet = true;
    return this;
  }

  update(patch: Record<string, unknown>): this {
    this.action = { kind: 'update', patch };
    this.verbSet = true;
    return this;
  }

  upsert(rows: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string }): this {
    this.action = { kind: 'upsert', rows: Array.isArray(rows) ? rows : [rows], onConflict: opts?.onConflict };
    this.verbSet = true;
    return this;
  }

  delete(): this {
    this.action = { kind: 'delete' };
    this.verbSet = true;
    return this;
  }

  eq(col: string, val: unknown): this {
    this.filters.push({ col, op: 'eq', val });
    return this;
  }

  neq(col: string, val: unknown): this {
    this.filters.push({ col, op: 'neq', val });
    return this;
  }

  in(col: string, vals: unknown[]): this {
    this.filters.push({ col, op: 'in', val: vals });
    return this;
  }

  is(col: string, val: null | boolean): this {
    this.filters.push({ col, op: 'is', val });
    return this;
  }

  ilike(col: string, pattern: string): this {
    this.filters.push({ col, op: 'ilike', val: pattern });
    return this;
  }

  like(col: string, pattern: string): this {
    this.filters.push({ col, op: 'like', val: pattern });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderBy.push({ col, ascending: opts?.ascending ?? true });
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  single<U = T>(): PgTable<U, 'one'> {
    this.wantSingle = 'single';
    return this as unknown as PgTable<U, 'one'>;
  }

  // its own data is nullable (0 rows is not an error) unlike .single()'s, hence `U | null` here
  maybeSingle<U = T>(): PgTable<U | null, 'one'> {
    this.wantSingle = 'maybeSingle';
    return this as unknown as PgTable<U | null, 'one'>;
  }

  // appends placeholders to the shared `values` array as it goes, so a caller that already
  // pushed e.g. an UPDATE's SET values gets WHERE placeholders correctly offset after them
  private buildWhere(values: unknown[]): string {
    const clauses = this.filters.map((f) => {
      switch (f.op) {
        case 'eq':
          values.push(f.val);
          return `${quote(f.col)} = $${values.length}`;
        case 'neq':
          values.push(f.val);
          return `${quote(f.col)} <> $${values.length}`;
        case 'in': {
          const vals = f.val as unknown[];
          if (!vals.length) return 'false'; // matches PostgREST: an empty IN list matches nothing
          const placeholders = vals.map((v) => {
            values.push(v);
            return `$${values.length}`;
          });
          return `${quote(f.col)} IN (${placeholders.join(', ')})`;
        }
        case 'is':
          return `${quote(f.col)} IS ${f.val === null ? 'NULL' : f.val ? 'TRUE' : 'FALSE'}`;
        case 'ilike':
          values.push(f.val);
          return `${quote(f.col)} ILIKE $${values.length}`;
        case 'like':
          values.push(f.val);
          return `${quote(f.col)} LIKE $${values.length}`;
      }
    });
    return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  }

  private async run(): Promise<PgResult<any>> {
    const values: unknown[] = [];
    let text: string;
    // a local const narrows across the switch; repeated `this.action.kind` reads do not
    const action = this.action;

    switch (action.kind) {
      case 'select': {
        const where = this.buildWhere(values);
        if (action.head) {
          const result = await this.pool.query(`SELECT count(*)::int AS count FROM ${quote(this.table)} ${where}`, values);
          return { data: null, error: null, count: result.rows[0]?.count ?? 0 };
        }
        const order = this.orderBy.length
          ? `ORDER BY ${this.orderBy.map((o) => `${quote(o.col)} ${o.ascending ? 'ASC' : 'DESC'}`).join(', ')}`
          : '';
        const limit = this.limitN !== null ? `LIMIT ${this.limitN}` : '';
        text = `SELECT ${action.columns} FROM ${quote(this.table)} ${where} ${order} ${limit}`;
        break;
      }
      case 'insert': {
        const cols = Object.keys(action.rows[0] ?? {});
        const valueRows = action.rows.map((row) => {
          const placeholders = cols.map((c) => {
            values.push(row[c]);
            return `$${values.length}`;
          });
          return `(${placeholders.join(', ')})`;
        });
        text = `INSERT INTO ${quote(this.table)} (${cols.map(quote).join(', ')}) VALUES ${valueRows.join(', ')} RETURNING ${this.returningColumns}`;
        break;
      }
      case 'update': {
        const cols = Object.keys(action.patch);
        const setClauses = cols.map((c) => {
          values.push(action.patch[c]);
          return `${quote(c)} = $${values.length}`;
        });
        const where = this.buildWhere(values);
        text = `UPDATE ${quote(this.table)} SET ${setClauses.join(', ')} ${where} RETURNING ${this.returningColumns}`;
        break;
      }
      case 'upsert': {
        const cols = Object.keys(action.rows[0] ?? {});
        const valueRows = action.rows.map((row) => {
          const placeholders = cols.map((c) => {
            values.push(row[c]);
            return `$${values.length}`;
          });
          return `(${placeholders.join(', ')})`;
        });
        const conflictCols = (action.onConflict ?? '').split(',').map((c) => c.trim()).filter(Boolean);
        const updateSet = cols.filter((c) => !conflictCols.includes(c)).map((c) => `${quote(c)} = EXCLUDED.${quote(c)}`);
        const onConflict = conflictCols.length
          ? `ON CONFLICT (${conflictCols.map(quote).join(', ')}) DO UPDATE SET ${updateSet.join(', ')}`
          : '';
        text = `INSERT INTO ${quote(this.table)} (${cols.map(quote).join(', ')}) VALUES ${valueRows.join(', ')} ${onConflict} RETURNING ${this.returningColumns}`;
        break;
      }
      case 'delete': {
        const where = this.buildWhere(values);
        text = `DELETE FROM ${quote(this.table)} ${where} RETURNING ${this.returningColumns}`;
        break;
      }
    }

    const result = await this.pool.query(text, values);
    const rows = result.rows;

    if (this.wantSingle === 'single') {
      if (rows.length !== 1) return { data: null, error: { message: `Expected exactly one row, got ${rows.length}`, code: 'PGRST116' } };
      return { data: rows[0], error: null };
    }
    if (this.wantSingle === 'maybeSingle') {
      if (rows.length > 1) return { data: null, error: { message: `Expected at most one row, got ${rows.length}`, code: 'PGRST116' } };
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows as any, error: null };
  }

  then<TResult1 = PgResult<ManyOrOne<T, Mode>>, TResult2 = never>(
    onFulfilled?: ((value: PgResult<ManyOrOne<T, Mode>>) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run()
      .catch((err: any): PgResult<any> => ({ data: null, error: { message: err.message, code: err.code } }))
      .then(onFulfilled, onRejected);
  }
}

/** `SELECT * FROM "name"(arg => $1, ...)` - every `.rpc()` call in this codebase passes fully
 * named params and its function returns either one row of one column (unwrapped to that scalar/
 * JSON value here) or a set of rows (returned as-is) - no function here needs anything richer. */
export async function rpc(pool: Pool, name: string, params: Record<string, unknown> = {}): Promise<PgResult<any>> {
  try {
    const keys = Object.keys(params);
    const values = keys.map((k) => params[k]);
    const args = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
    const result = await pool.query(`SELECT * FROM ${quote(name)}(${args})`, values);
    if (result.rows.length === 1 && Object.keys(result.rows[0]).length === 1) {
      return { data: Object.values(result.rows[0])[0], error: null };
    }
    return { data: result.rows, error: null };
  } catch (err: any) {
    return { data: null, error: { message: err.message, code: err.code } };
  }
}
