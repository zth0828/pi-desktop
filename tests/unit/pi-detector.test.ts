import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  detectNpm,
  detectPi,
  detectPiPackageRoot,
  isUnderDir,
  locatePackageRoot,
  needsWindowsCommandShell,
} from '@electron/utils/pi-detector';
import { _resetUserPathCache } from '@electron/utils/shell-env';

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

  it('Windows npm 的 pi.cmd 映射到全局包内真实 CLI', () => {
    const prefix = path.join(root, 'windows-prefix');
    const globalRoot = path.join(prefix, 'node_modules');
    const windowsPkgDir = path.join(globalRoot, '@earendil-works/pi-coding-agent');
    const cliPath = path.join(windowsPkgDir, 'dist/cli.js');
    mkdirSync(path.dirname(cliPath), { recursive: true });
    writeFileSync(
      path.join(windowsPkgDir, 'package.json'),
      JSON.stringify({
        name: '@earendil-works/pi-coding-agent',
        version: '0.84.2',
        bin: { pi: 'dist/cli.js' },
      }),
    );
    writeFileSync(cliPath, '#!/usr/bin/env node\n');
    writeFileSync(path.join(prefix, 'pi.cmd'), '@echo off\r\n');

    const previousPath = process.env.PI_DESKTOP_USER_PATH;
    process.env.PI_DESKTOP_USER_PATH = prefix;
    _resetUserPathCache();
    try {
      expect(detectPi({ found: true, globalRoot: realpathSync(globalRoot) }, 'win32')).toMatchObject({
        found: true,
        binPath: path.join(prefix, 'pi.cmd'),
        realBinPath: realpathSync(cliPath),
        packageRoot: realpathSync(windowsPkgDir),
        version: '0.84.2',
        installKind: 'npm',
        meetsMin: true,
      });
    } finally {
      if (previousPath === undefined) delete process.env.PI_DESKTOP_USER_PATH;
      else process.env.PI_DESKTOP_USER_PATH = previousPath;
      _resetUserPathCache();
    }
  });

  it('Windows 不执行 npm prefix 外的同名 cmd，直接使用已验证的全局包', () => {
    const prefix = path.join(root, 'windows-prefix');
    const globalRoot = path.join(prefix, 'node_modules');
    const unrelatedBin = path.join(root, 'unrelated-bin');
    mkdirSync(unrelatedBin, { recursive: true });
    writeFileSync(path.join(unrelatedBin, 'pi.cmd'), '@echo off\r\n');

    const previousPath = process.env.PI_DESKTOP_USER_PATH;
    process.env.PI_DESKTOP_USER_PATH = unrelatedBin;
    _resetUserPathCache();
    try {
      expect(detectPi({ found: true, globalRoot: realpathSync(globalRoot) }, 'win32')).toMatchObject({
        found: true,
        binPath: undefined,
        realBinPath: realpathSync(path.join(globalRoot, '@earendil-works/pi-coding-agent/dist/cli.js')),
        packageRoot: realpathSync(path.join(globalRoot, '@earendil-works/pi-coding-agent')),
        version: '0.84.2',
        installKind: 'npm',
        meetsMin: true,
      });
    } finally {
      if (previousPath === undefined) delete process.env.PI_DESKTOP_USER_PATH;
      else process.env.PI_DESKTOP_USER_PATH = previousPath;
      _resetUserPathCache();
    }
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
