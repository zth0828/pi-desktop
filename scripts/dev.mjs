// dev 启动包装器：macOS 下先生成自定义 Electron.app bundle（菜单栏显示
// Pi Desktop 而非 Electron），再以 ELECTRON_OVERRIDE_DIST_PATH 指向该 bundle
// 启动 vite（electron 包的路径解析会优先使用该环境变量）。
// Windows/Linux 直接启动 vite，行为与原来一致。
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDevMacBundle } from './make-dev-mac-bundle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.platform === 'darwin') {
  const bundle = await ensureDevMacBundle();
  if (bundle) {
    process.env.ELECTRON_OVERRIDE_DIST_PATH = path.join(root, '.dev');
  }
}

const child = spawn('vite', process.argv.slice(2), {
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
