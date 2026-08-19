// piFiles：@ 文件引用的候选列表（cwd 下递归，相对路径）。
// 与 pi TUI 同一通道：fd（尊重 .gitignore；经 pi ensureTool 解析，系统 fd 优先、
// 缺失时由 pi 下载到其 bin 目录）。fd 不可用（离线首装等）回退 node fs 递归。
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { PiFileListPayload, PiFileListResult } from '@shared/host-api/contract';
import { loadPiAdapter } from './pi-adapter';

const MAX_FILES = 200;
const EXCLUDED_DIRS = new Set(['.git', 'node_modules']);

let fdPathPromise: Promise<string | null> | null = null;

/** fd 路径解析只试一次（含下载）；失败缓存 null，不每次 @ 都重试。 */
function resolveFd(): Promise<string | null> {
  fdPathPromise ??= loadPiAdapter()
    .then((adapter) => adapter.paths.ensureTool('fd', true))
    .catch(() => null);
  return fdPathPromise;
}

/** pi TUI autocomplete 的 fd 参数（walkDirectoryWithFd），只取文件（目录候选壳不需要）。 */
function listWithFd(cwd: string, fdPath: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    const child = spawn(
      fdPath,
      [
        '--base-directory', cwd,
        '--max-results', String(MAX_FILES),
        '--type', 'f',
        '--follow',
        '--hidden',
        '--exclude', '.git',
        '--exclude', '.git/*',
        '--exclude', '.git/**',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
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
      resolve(stdout.trim().split('\n').filter(Boolean).slice(0, MAX_FILES));
    });
  });
}

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  if (out.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(path.join(root, dir), { withFileTypes: true });
  } catch {
    return; // 读不了的目录跳过
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      await walk(root, rel, out);
    } else if (entry.isFile()) {
      out.push(rel);
    }
    // 符号链接不跟随（避免循环）
  }
}

export const filesApi = {
  list: async (payload: PiFileListPayload): Promise<PiFileListResult> => {
    const fd = await resolveFd();
    if (fd) {
      const files = await listWithFd(payload.cwd, fd);
      if (files) return { files };
    }
    const files: string[] = [];
    await walk(payload.cwd, '', files);
    return { files };
  },
};
