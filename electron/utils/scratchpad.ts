import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stripWindowsExtendedPrefix } from './same-path';
import { isWindowsDevicePath } from './workspace-path';

/** 获取全局草稿沙箱根目录：~/.pi/scratchpad（与 ~/.pi/agent 平级） */
export function getScratchpadRootDir(): string {
  const customAgentDir = process.env.PI_CODING_AGENT_DIR;
  if (customAgentDir) {
    return path.join(path.dirname(customAgentDir), 'scratchpad');
  }
  return path.join(os.homedir(), '.pi', 'scratchpad');
}

/** 判断目标路径是否属于草稿沙箱目录或其子沙箱 */
export function isScratchpadPath(targetPath?: string | null): boolean {
  if (!targetPath || typeof targetPath !== 'string') return false;
  const clean = stripWindowsExtendedPrefix(targetPath);
  if (isWindowsDevicePath(clean)) return false;
  const root = stripWindowsExtendedPrefix(getScratchpadRootDir());
  const rel = path.relative(root, clean);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

/** 确保为指定会话分配的独立沙箱子目录存在，并写入基本的 .gitignore */
export async function ensureScratchpadSessionDir(sessionKey: string): Promise<string> {
  const root = getScratchpadRootDir();
  const safeKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
  const sessionDir = path.join(root, `s_${safeKey}`);
  await mkdir(sessionDir, { recursive: true });
  const gitignorePath = path.join(sessionDir, '.gitignore');
  try {
    await writeFile(gitignorePath, '# Pi Desktop Scratchpad\nnode_modules/\n.cache/\n', { flag: 'wx' });
  } catch {
    // 若已存在忽略 EEXIST
  }
  return sessionDir;
}

/** 清理特定会话的草稿沙箱 */
export async function cleanScratchpadSessionDir(sessionKeyOrPath: string): Promise<void> {
  if (!sessionKeyOrPath) return;
  const target = isScratchpadPath(sessionKeyOrPath)
    ? sessionKeyOrPath
    : path.join(getScratchpadRootDir(), `s_${sessionKeyOrPath.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
  if (isScratchpadPath(target) && target !== getScratchpadRootDir()) {
    await rm(target, { recursive: true, force: true }).catch(() => {});
  }
}
