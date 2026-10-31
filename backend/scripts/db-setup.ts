// Sets up the Supabase database from backend/.env, in the order the README lists.
// Never wipes anything, and is safe to run again.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const DB_DIR = join(import.meta.dirname, '..', '..', 'database');
const FILES = ['schema.sql', 'product_catalog.sql', 'subscriptions_billing.sql', 'billing_integration.sql', 'payments_analytics.sql'];

if (!process.env.DATABASE_URL) {
  console.error('Add DATABASE_URL to backend/.env first.');
  process.exit(1);
}
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});
await client.connect();
try {
  for (const file of FILES) {
    await client.query(readFileSync(join(DB_DIR, file), 'utf8'));
    console.log(`applied ${file}`);
  }
  const { rows } = await client.query(`SELECT count(*)::int AS tables FROM information_schema.tables WHERE table_schema = 'public'`);
  console.log(`Done. The database now has ${rows[0].tables} tables.`);
} finally {
  await client.end();
}
