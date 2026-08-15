// piSkills：技能列表（M5）。数据源是活动 runtime 的 resourceLoader.getSkills()，
// runtime 未启动时返回空。SettingsManager 没有 per-skill 启停 API（只有路径增减），
// 所以本模块只读——启停交给 pi 自己的配置，壳不乱造 settings.json 格式。
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { PiSkillListResult, PiSkillRow, PiSkillSource } from '@shared/host-api/contract';
import { resolveRuntimeForContext } from './pi-runtime-api';
import type { HostActionContext } from '../main/ipc/host-contract';

/** macOS /tmp → /private/tmp symlink：路径比较前两边 realpath（AGENTS.md）。 */
function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function isUnderDir(child: string, parent: string): boolean {
  const rel = path.relative(safeRealpath(parent), safeRealpath(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function classifySource(
  skill: { filePath: string; sourceInfo?: { origin?: string; scope?: string } },
  agentDir: string,
  cwd: string,
): PiSkillSource {
  if (skill.sourceInfo?.origin === 'package') return 'package';
  if (isUnderDir(skill.filePath, path.join(agentDir, 'skills'))) return 'agentDir';
  if (isUnderDir(skill.filePath, path.join(homedir(), '.agents', 'skills'))) return 'user';
  if (isUnderDir(skill.filePath, path.join(cwd, '.pi', 'skills'))) return 'project';
  // 路径推导落空时按 pi 给的 scope 兜底
  return skill.sourceInfo?.scope === 'project' ? 'project' : 'user';
}

export const skillsApi = {
  list: async (_payload?: unknown, ctx?: HostActionContext): Promise<PiSkillListResult> => {
    const active = resolveRuntimeForContext(ctx);
    if (!active) return { skills: [], runtimeActive: false };
    const agentDir = active.sdk.getAgentDir();
    const { skills } = active.runtime.services.resourceLoader.getSkills();
    const rows: PiSkillRow[] = skills.map((s) => ({
      name: s.name,
      description: s.description,
      filePath: s.filePath,
      source: classifySource(s, agentDir, active.cwd),
      sourceDetail: s.sourceInfo
        ? `${s.sourceInfo.source} · ${s.sourceInfo.scope}`
        : undefined,
      disableModelInvocation: s.disableModelInvocation,
    }));
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return { skills: rows, runtimeActive: true };
  },
};
