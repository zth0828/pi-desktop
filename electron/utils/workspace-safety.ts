// 工作区安全护栏：禁止把用户主目录 / 文件系统根作为 pi 工作区。
// 在这些目录启动，agent 会扫描/触碰用户全部个人文件，且会话历史与个人目录
// 混在一起，删除或清理时容易误伤。macOS/Linux/Windows 统一判定（realpath
// 归一化 symlink、/tmp → /private/tmp 等形式差异，比较前两侧都解析）。
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type RiskyWorkspaceReason = 'home' | 'root';

function resolveExisting(target: string): string | null {
  try {
    return realpathSync(target);
  } catch {
    // 目录不存在/无权限：放行，由 runtime 的正常报错路径处理
    return null;
  }
}

export function riskyWorkspaceReason(cwd: string): RiskyWorkspaceReason | null {
  const resolved = resolveExisting(cwd);
  if (resolved === null) return null;
  const home = resolveExisting(os.homedir());
  if (home !== null && resolved === home) return 'home';
  if (resolved === path.parse(resolved).root) return 'root';
  return null;
}
