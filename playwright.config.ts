import { defineConfig } from '@playwright/test';
import os from 'node:os';

// 并行 worker：每个测试独立 HOME/user-data、mock server 随机端口，无共享可变状态。
// worker 数按 CPU 与内存预算取（每个并行 Electron 峰值约 1.5-2GB，内存不足时
// 并行会互相拖慢/超时）；首次安装 pi 测试前缀由 helpers/pi-prefix 互斥锁串行化。
const cpus = os.cpus().length;
const memGb = os.totalmem() / 2 ** 30;
const workers = process.env.CI
  ? 4
  : Math.min(4, Math.max(2, cpus - 1), Math.max(2, Math.round(memGb / 2)));

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers,
  retries: 0,
  reporter: 'list',
});
