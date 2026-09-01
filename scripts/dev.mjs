// dev 启动包装器：macOS 下先生成自定义 Electron.app bundle（菜单栏显示
// Pi Desktop 而非 Electron），再以 ELECTRON_OVERRIDE_DIST_PATH 指向该 bundle
// 启动 vite（electron 包的路径解析会优先使用该环境变量）。
// Windows/Linux 直接启动 vite，行为与原来一致。
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ensureDevMacBundle } from './make-dev-mac-bundle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
// 直接 spawn node + vite 的 JS 入口，而非 spawn 'vite'：Windows 上
// node_modules/.bin 里的 vite.cmd 是 cmd 脚本，spawn 不经过 shell 无法
// 解析（报 spawn vite ENOENT）；node 入口三平台一致，也不依赖 PATH。
// vite 的 exports 未导出 ./bin/vite.js，改从 package.json 的 bin 字段解析。
const vitePkgPath = require.resolve('vite/package.json');
const vitePkg = JSON.parse(readFileSync(vitePkgPath, 'utf8'));
const viteBin = path.join(path.dirname(vitePkgPath), vitePkg.bin.vite);

if (process.platform === 'darwin') {
  const bundle = await ensureDevMacBundle();
  if (bundle) {
    process.env.ELECTRON_OVERRIDE_DIST_PATH = path.join(root, '.dev');
  }
}

const child = spawn(process.execPath, [viteBin, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
child.on('error', (error) => {
  console.error(`Failed to start vite: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 0;
});
