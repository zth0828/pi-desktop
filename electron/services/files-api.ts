// piFiles：@ 文件引用的候选列表（cwd 下递归，相对路径）。
// pi TUI 走 fd；壳从简用 node fs 递归（排除 .git/node_modules，上限 MAX_FILES 条）。
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { PiFileListPayload, PiFileListResult } from '@shared/host-api/contract';

const MAX_FILES = 200;
const EXCLUDED_DIRS = new Set(['.git', 'node_modules']);

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
    const files: string[] = [];
    await walk(payload.cwd, '', files);
    return { files };
  },
};
