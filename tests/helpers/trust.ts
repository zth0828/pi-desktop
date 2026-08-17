// 预置项目信任：工作区含 .pi 门控资源时 pi 会要求显式信任，
// 不涉及信任交互本身的 spec 统一预信任（realpath 对齐 pi canonicalizePath 的 key 规范化）。
import { realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function seedTrustedWorkspace(agentDir: string, workspace: string): Promise<void> {
  await writeFile(
    path.join(agentDir, 'trust.json'),
    JSON.stringify({ [realpathSync(workspace)]: true }),
  );
}
