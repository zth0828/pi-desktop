// piSkills：技能列表 + 查看 + 外部导入。列表数据源是活动 runtime 的
// resourceLoader.getSkills()，runtime 未启动时返回空。SettingsManager 没有
// per-skill 启停 API（只有路径增减），启停交给 pi 自己的配置，壳不乱造 settings.json 格式。
// 导入 = 复制目录到 agentDir/skills（不建软链），目标目录与 pi 的用户级 skills 目录一致。
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type {
  PiExternalSkill,
  PiSkillImportPayload,
  PiSkillImportResult,
  PiSkillListResult,
  PiSkillReadPayload,
  PiSkillReadResult,
  PiSkillRow,
  PiSkillScanExternalPayload,
  PiSkillScanExternalResult,
  PiSkillSource,
} from '@shared/host-api/contract';
import { resolveRuntimeForContext } from './pi-runtime-api';
import type { HostActionContext } from '../main/ipc/host-contract';

/** macOS /tmp → /private/tmp symlink：路径比较前两边 realpath。 */
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

/** 导入目标根：优先活动 runtime 的 agentDir；未启动时回退与 pi 默认一致的用户目录。 */
function resolveAgentDir(ctx?: HostActionContext): string {
  const active = resolveRuntimeForContext(ctx);
  if (active) return active.sdk.getAgentDir();
  return process.env.PI_CODING_AGENT_DIR ?? path.join(homedir(), '.pi', 'agent');
}

/** 列出 dir 下含 SKILL.md 的子目录，并与导入目标比较同名状态；dir 不存在返回 null。 */
async function scanSkillDir(dir: string, targetDir: string): Promise<PiExternalSkill[] | null> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const skills: PiExternalSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(dir, entry.name);
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    let status: PiExternalSkill['status'] = 'new';
    const targetFile = path.join(targetDir, entry.name, 'SKILL.md');
    if (existsSync(targetFile)) {
      const [incoming, existing] = await Promise.all([
        readFile(skillFile, 'utf8').catch(() => ''),
        readFile(targetFile, 'utf8').catch(() => ''),
      ]);
      status = incoming === existing ? 'same' : 'conflict';
    }
    skills.push({ name: entry.name, dir: skillDir, status });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** name 被占用时找 name-2 / name-3 … 第一个空位。 */
async function freeSkillName(targetDir: string, name: string): Promise<string> {
  for (let i = 2; ; i += 1) {
    const candidate = `${name}-${i}`;
    if (!existsSync(path.join(targetDir, candidate))) return candidate;
  }
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

  read: async (payload: PiSkillReadPayload): Promise<PiSkillReadResult> => {
    // 查看用：只读 SKILL.md 原文，截断兜底（正常 skill 文件远低于此）
    const content = await readFile(payload.filePath, 'utf8');
    return { content: content.length > 512 * 1024 ? `${content.slice(0, 512 * 1024)}\n…` : content };
  },

  scanExternal: async (payload?: PiSkillScanExternalPayload, ctx?: HostActionContext): Promise<PiSkillScanExternalResult> => {
    const targetDir = path.join(resolveAgentDir(ctx), 'skills');
    const candidates: Array<{ id: string; dir: string }> = [
      { id: 'claude', dir: path.join(homedir(), '.claude', 'skills') },
      { id: 'codex', dir: path.join(homedir(), '.codex', 'skills') },
      ...(payload?.extraDirs ?? []).map((dir) => ({ id: 'manual', dir })),
    ];
    const sources = [];
    for (const candidate of candidates) {
      const skills = await scanSkillDir(candidate.dir, targetDir);
      sources.push({
        id: candidate.id,
        dir: candidate.dir,
        exists: skills !== null,
        skills: skills ?? [],
      });
    }
    return { targetDir, sources };
  },

  import: async (payload: PiSkillImportPayload, ctx?: HostActionContext): Promise<PiSkillImportResult> => {
    const targetDir = path.join(resolveAgentDir(ctx), 'skills');
    const results: PiSkillImportResult['results'] = [];
    for (const item of payload.skills) {
      try {
        if (!item.name || item.name.includes('/') || item.name.includes('\\') || item.name === '..' || item.name === '.') {
          results.push({ name: item.name, ok: false, action: 'error', error: 'invalid name' });
          continue;
        }
        if (!existsSync(path.join(item.dir, 'SKILL.md'))) {
          results.push({ name: item.name, ok: false, action: 'error', error: 'SKILL.md missing' });
          continue;
        }
        const dest = path.join(targetDir, item.name);
        const exists = existsSync(dest);
        if (exists && item.strategy === 'skip') {
          results.push({ name: item.name, ok: true, action: 'skipped' });
          continue;
        }
        let finalName = item.name;
        let finalDest = dest;
        if (exists && item.strategy === 'rename') {
          finalName = await freeSkillName(targetDir, item.name);
          finalDest = path.join(targetDir, finalName);
        }
        if (exists && item.strategy === 'overwrite') await rm(dest, { recursive: true, force: true });
        await mkdir(path.dirname(finalDest), { recursive: true });
        // 复制而非软链：导入后与原工具目录解耦，各自演进互不影响
        await cp(item.dir, finalDest, { recursive: true });
        results.push({
          name: item.name,
          ok: true,
          action: finalName !== item.name ? `renamed:${finalName}` : exists ? 'overwritten' : 'imported',
        });
      } catch (err) {
        results.push({ name: item.name, ok: false, action: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { results };
  },
};
