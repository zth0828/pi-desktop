// piFiles：@ 文件引用的候选列表（cwd 下递归，相对路径）。
// 与 pi TUI 同一通道：fd（尊重 .gitignore；经 pi ensureTool 解析，系统 fd 优先、
// 缺失时由 pi 下载到其 bin 目录）。fd 不可用（离线首装、GitHub 限流/代理拦截等，
// Windows 上尤其常见）回退 node fs 递归——回退同样按 .gitignore 过滤，避免
// 被忽略的文件泄漏进补全面板（逐层解析 .gitignore，深层规则覆盖浅层）。
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import type { PiFileListDirPayload, PiFileListDirResult, PiFileListPayload, PiFileListResult } from '@shared/host-api/contract';
import { loadPiAdapter } from './pi-adapter';
import { readIgnoreLevel, isIgnored, walkGitignoreAware, DEFAULT_EXCLUDED_DIRS, type IgnoreLevel } from '../utils/gitignore-walk';
import { stripWindowsExtendedPrefix } from '../utils/same-path';
import { isInsideWorkspace } from '../utils/previewable-files';
import { isWindowsDevicePath } from '../utils/workspace-path';

const MAX_FILES = 200;

let fdPathPromise: Promise<string | null> | null = null;

/** fd 路径解析只试一次（含下载）；失败缓存 null，不每次 @ 都重试。 */
function resolveFd(): Promise<string | null> {
  fdPathPromise ??= Promise.race([
    loadPiAdapter()
      .then((adapter) => adapter.paths.ensureTool('fd', true))
      .catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), 1000)),
  ]);
  return fdPathPromise;
}

/** pi TUI autocomplete 的 fd 参数（walkDirectoryWithFd），只取文件（目录候选壳不需要）。 */
function listWithFd(cwd: string, fdPath: string): Promise<string[] | null> {
  const cleanCwd = stripWindowsExtendedPrefix(cwd);
  return new Promise((resolve) => {
    const child = spawn(
      fdPath,
      [
        '--base-directory', cleanCwd,
        '--max-results', String(MAX_FILES),
        '--type', 'f',
        '--follow',
        '--hidden',
        '--exclude', '.git',
        '--exclude', '.git/*',
        '--exclude', '.git/**',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    );
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        resolve(code === 0 ? [] : null);
        return;
      }
      resolve(
        stdout
          .split(/\r?\n/)
          .map((line) => line.trim().replace(/\\/g, '/'))
          .filter(Boolean)
          .slice(0, MAX_FILES),
      );
    });
  });
}

/**
 * 回退遍历：.gitignore 感知（见 gitignore-walk），根层规则从工作区根开始。
 */
async function walk(root: string, out: string[]): Promise<void> {
  const rootLevel = await readIgnoreLevel(root, '', '');
  await walkGitignoreAware(root, '', out, rootLevel ? [rootLevel] : [], { maxFiles: MAX_FILES });
}

export const filesApi = {
  list: async (payload: PiFileListPayload): Promise<PiFileListResult> => {
    const cleanCwd = stripWindowsExtendedPrefix(payload.cwd);
    const fd = await resolveFd();
    if (fd) {
      const files = await listWithFd(cleanCwd, fd);
      if (files) return { files };
    }
    const files: string[] = [];
    await walk(cleanCwd, files);
    return { files };
  },

  /** 逐层列目录：手动文件面板的树形浏览（不烧 pi quota，纯文件系统浏览）。 */
  listDir: async (payload: PiFileListDirPayload): Promise<PiFileListDirResult> => {
    const base = stripWindowsExtendedPrefix(payload.cwd);
    const rel = (payload.dir ?? '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (isWindowsDevicePath(rel)) {
      return { dir: rel, dirs: [], files: [] };
    }
    const dirPath = path.join(base, rel);
    if (!isInsideWorkspace(base, dirPath)) {
      return { dir: rel, dirs: [], files: [] };
    }
    const levels: IgnoreLevel[] = [];
    const rootLevel = await readIgnoreLevel(base, '', '');
    if (rootLevel) levels.push(rootLevel);
    if (rel) {
      let currentSeg = '';
      for (const seg of rel.split('/')) {
        currentSeg = currentSeg ? `${currentSeg}/${seg}` : seg;
        const subLevel = await readIgnoreLevel(base, currentSeg, currentSeg);
        if (subLevel) levels.push(subLevel);
      }
    }
    const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => [] as Dirent[]);
    const dirs: string[] = [];
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.git') || DEFAULT_EXCLUDED_DIRS.has(entry.name)) continue;
      const relEntry = rel ? `${rel}/${entry.name}` : entry.name;
      if (isIgnored(levels, relEntry)) continue;
      if (entry.isDirectory()) dirs.push(entry.name);
      else if (entry.isFile()) files.push(entry.name);
    }
    dirs.sort((a, b) => a.localeCompare(b));
    files.sort((a, b) => a.localeCompare(b));
    return { dir: rel, dirs, files };
  },
};
