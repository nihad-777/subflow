import 'dotenv/config';
import pg from 'pg';

// bigint ids -> JS number (safe up to 2^53). numeric stays a string; use lib/money.ts.
pg.types.setTypeParser(20, (v) => Number(v));
// DATE -> 'YYYY-MM-DD' string, never a shifted JS Date.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DB_POOL_MAX ?? 10),
});

export type Db = pg.Pool | pg.PoolClient;
export type Tx = pg.PoolClient;

export async function query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Db = pool) {
  const res = await db.query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Db = pool) {
  const rows = await query<T>(text, params, db);
  return rows[0] ?? null;
}

export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export const isUniqueViolation = (err: unknown, constraint?: string) =>
  typeof err === 'object' && err !== null && (err as any).code === '23505' &&
  (!constraint || (err as any).constraint === constraint);
