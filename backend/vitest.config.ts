import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './test/global-setup.ts',
    include: ['test/**/*.test.ts'],
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://subflow:subflow@localhost:5432/subflow_test',
      DATABASE_SSL: 'false',
      DEV_AUTH: 'true',
      SUPABASE_JWT_SECRET: 'test-secret-at-least-32-characters-long!!',
    },
    fileParallelism: false,
    testTimeout: 20000,
  },
});
