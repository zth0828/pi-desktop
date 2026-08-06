import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// L2 契约测试：真 pi（tests/helpers/pi-prefix 安装的隔离 prefix）+ mock provider。
// 与单元测试分开跑：pnpm test:contract
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@electron': resolve(__dirname, 'electron'),
      '@shared': resolve(__dirname, 'shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/contract/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
