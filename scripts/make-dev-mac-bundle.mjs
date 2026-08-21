// macOS dev：生成自定义 Electron.app bundle（CFBundleName = Pi Desktop）。
// 让 dev 模式的系统菜单栏显示 Pi Desktop 而非 Electron（系统应用菜单标题取自
// bundle 的 CFBundleName，与 app.setName 解耦，打包产物 bundle 名正确所以不受影响）。
// 用 APFS clone（cp -c）复制 node_modules 里的 Electron.app（CoW 几乎不占磁盘），
// 修改 Info.plist 应用名后必须整体 ad-hoc 重新签名：改 Info.plist 会使原签名失效，
// helper 子进程会被系统拒绝而崩溃。版本一致时跳过（幂等，启动快）。
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcApp = path.join(root, 'node_modules/electron/dist/Electron.app');
const dstApp = path.join(root, '.dev/Electron.app');
const plistBuddy = '/usr/libexec/PlistBuddy';

function plistGet(plistPath, key) {
  try {
    return execFileSync(plistBuddy, ['-c', `Print :${key}`, plistPath], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/** 确保 dev bundle 存在且与当前 electron 版本匹配；返回 bundle 路径或 null（非 macOS）。 */
export async function ensureDevMacBundle() {
  if (process.platform !== 'darwin') return null;
  if (!existsSync(path.join(srcApp, 'Contents/Info.plist'))) return null;

  const srcPlist = path.join(srcApp, 'Contents/Info.plist');
  const dstPlist = path.join(dstApp, 'Contents/Info.plist');
  const srcVersion = plistGet(srcPlist, 'CFBundleVersion');
  const dstVersion = existsSync(dstPlist) ? plistGet(dstPlist, 'CFBundleVersion') : '';
  const dstName = existsSync(dstPlist) ? plistGet(dstPlist, 'CFBundleName') : '';
  if (dstVersion === srcVersion && dstName === 'Pi Desktop') return dstApp;

  console.log('[dev-bundle] rebuilding Pi Desktop.app dev bundle…');
  await rm(dstApp, { recursive: true, force: true });
  // APFS clone（CoW）快速复制，不占双倍磁盘
  execFileSync('cp', ['-cR', srcApp, dstApp], { stdio: 'inherit' });
  for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
    execFileSync(plistBuddy, ['-c', `Set :${key} Pi Desktop`, dstPlist]);
  }
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', dstApp], { stdio: 'inherit' });
  console.log('[dev-bundle] done:', dstApp);
  return dstApp;
}

// 直接执行（node scripts/make-dev-mac-bundle.mjs）时同步构建
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await ensureDevMacBundle();
}
