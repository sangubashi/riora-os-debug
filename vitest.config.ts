import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // pglite (WASM Postgres) の起動 + migration適用に数秒かかるため、
    // デフォルトの5000msでは不足するケースがある。
    testTimeout: 30000,
    // beforeAllでcreateTestDb()+applyMigrations()を行うdbテストは、
    // 並列実行時のリソース競合でデフォルト10000msを超えることがある。
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
