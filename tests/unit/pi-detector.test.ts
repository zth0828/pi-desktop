import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  detectNpm,
  detectPiPackageRoot,
  isUnderDir,
  locatePackageRoot,
  needsWindowsCommandShell,
} from '@electron/utils/pi-detector';

// 模拟 npm 全局安装布局：<prefix>/bin/pi → symlink → <prefix>/lib/node_modules/@scope/pkg/dist/cli.js
const root = mkdtempSync(path.join(tmpdir(), 'pi-detector-test-'));
const pkgDir = path.join(root, 'lib/node_modules/@earendil-works/pi-coding-agent');
mkdirSync(path.join(pkgDir, 'dist'), { recursive: true });
mkdirSync(path.join(root, 'bin'), { recursive: true });
writeFileSync(
  path.join(pkgDir, 'package.json'),
  JSON.stringify({
    name: '@earendil-works/pi-coding-agent',
    version: '0.83.0',
    bin: { pi: 'dist/cli.js' },
  }),
);
writeFileSync(path.join(pkgDir, 'dist/cli.js'), '#!/usr/bin/env node\n');
symlinkSync(path.join(pkgDir, 'dist/cli.js'), path.join(root, 'bin/pi'));

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('pi-detector 路径逻辑', () => {
  it('Windows 的 cmd/bat shim 通过 shell 执行', () => {
    expect(needsWindowsCommandShell('C:\\Program Files\\nodejs\\npm.cmd', 'win32')).toBe(true);
    expect(needsWindowsCommandShell('C:\\tools\\pi.BAT', 'win32')).toBe(true);
    expect(needsWindowsCommandShell('C:\\Program Files\\nodejs\\node.exe', 'win32')).toBe(false);
    expect(needsWindowsCommandShell('/usr/local/bin/npm', 'darwin')).toBe(false);
  });

  it.skipIf(process.platform !== 'win32')('Windows 可实际执行 PATH 中的 npm.cmd', () => {
    expect(detectNpm()).toMatchObject({ found: true });
  });

  it('locatePackageRoot 从 bin 真实路径向上找到包根与版本', () => {
    const located = locatePackageRoot(path.join(pkgDir, 'dist/cli.js'));
    expect(located?.packageRoot).toBe(pkgDir);
    expect(located?.version).toBe('0.83.0');
  });

  it('locatePackageRoot 对非 pi 路径返回 null', () => {
    expect(locatePackageRoot('/usr/local/bin/node')).toBeNull();
  });

  it('isUnderDir 判定 npm root 归属', () => {
    const npmRoot = path.join(root, 'lib/node_modules');
    expect(isUnderDir(pkgDir, npmRoot)).toBe(true);
    expect(isUnderDir('/usr/local/lib/node_modules/other', npmRoot)).toBe(false);
    expect(isUnderDir(npmRoot, npmRoot)).toBe(false); // 自身不算「之下」
  });

  it('显式 package root 保留真实安装类型并标记 dev override', () => {
    const detected = detectPiPackageRoot(pkgDir, { found: true, globalRoot: path.join(root, 'other') });
    expect(detected).toMatchObject({
      found: true,
      version: '0.83.0',
      packageRoot: realpathSync(pkgDir),
      installKind: 'non-npm',
      meetsMin: true,
      devOverride: true,
      devAllowsOutdated: false,
    });
  });

  it('显式 package root 拒绝非 pi package', () => {
    expect(detectPiPackageRoot(root, { found: true })).toBeNull();
  });
});
