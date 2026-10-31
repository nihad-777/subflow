import { setupLocalDb } from '../scripts/payments-db.js';

export default async function setup() {
  await setupLocalDb({ reset: true, url: process.env.TEST_DATABASE_URL ?? 'postgresql://subflow:subflow@localhost:5432/subflow_test' });
}
