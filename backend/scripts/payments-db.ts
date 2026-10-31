// LOCAL DEV/TEST database setup for the payments & analytics module.
// Applies the shim, then the team's SQL files in their Supabase order.
//   --reset   drop and recreate the public + auth schemas first
// On Supabase, run database/payments_analytics.sql in the SQL Editor instead.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const DB_DIR = join(import.meta.dirname, '..', '..', 'database');
const FILES = ['dev/local_supabase_shim.sql', 'schema.sql', 'product_catalog.sql', 'subscriptions_billing.sql', 'billing_integration.sql', 'payments_analytics.sql'];

export async function setupLocalDb(opts: { reset?: boolean; url?: string } = {}) {
  const url = opts.url ?? process.env.DATABASE_URL ?? '';
  if (/supabase\.(co|com)/.test(url)) throw new Error('Refusing to run local setup against Supabase. Use the SQL Editor.');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    if (opts.reset) await client.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA public;');
    await client.query('SET client_min_messages = warning');
    for (const f of FILES) {
      await client.query(readFileSync(join(DB_DIR, f), 'utf8'));
      console.log(`applied ${f}`);
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith('payments-db.ts')) {
  setupLocalDb({ reset: process.argv.includes('--reset') }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
