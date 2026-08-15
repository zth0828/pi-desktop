// piMcp：MCP server 配置管理（M5，docs §4.7 Spike B 结论）。
// 壳只读写两个文件：<agentDir>/mcp.json（全局）与 <cwd>/.mcp.json（项目），
// 标准 mcpServers 格式，读写保留文件里其他字段（helpers 在 utils/mcp-config.ts）。
// 状态展示是增强项：装了 pi-mcp-adapter 时读 eventBus 快照（pi-runtime-api 缓存）。
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  HostSuccess,
  PiMcpListResult,
  PiMcpServerConfig,
  PiMcpServerRefPayload,
  PiMcpServerRow,
  PiMcpServerStatus,
  PiMcpSetDisabledPayload,
  PiMcpUpsertPayload,
} from '@shared/host-api/contract';
import { loadPiSdk } from '../utils/pi-loader';
import { detectPiEnvironment } from '../utils/pi-detector';
import { envWithUserPath } from '../utils/shell-env';
import {
  listServers,
  readMcpConfigFile,
  removeServer,
  setServerDisabled,
  upsertServer,
  writeMcpConfigFile,
} from '../utils/mcp-config';
import { getLatestMcpStatusSnapshot, resolveRuntimeForContext } from './pi-runtime-api';
import type { HostActionContext } from '../main/ipc/host-contract';
import { settingsApi } from './settings-api';

const ADAPTER_PACKAGE = 'pi-mcp-adapter';
const ADAPTER_SOURCE = `npm:${ADAPTER_PACKAGE}`;

function toError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function resolvePaths(ctx?: HostActionContext): Promise<{ agentDir: string; cwd?: string }> {
  const sdk = await loadPiSdk();
  const agentDir = sdk.getAgentDir();
  const active = resolveRuntimeForContext(ctx);
  const cwd = active?.cwd ?? (await settingsApi.get({ key: 'workspaceCwd' })) ?? undefined;
  return { agentDir, cwd };
}

/** adapter 检测：<agentDir>/npm/node_modules/pi-mcp-adapter 或 settings.json packages 含它。 */
function detectAdapter(agentDir: string): boolean {
  if (existsSync(path.join(agentDir, 'npm', 'node_modules', ADAPTER_PACKAGE))) return true;
  try {
    const settingsPath = path.join(agentDir, 'settings.json');
    if (!existsSync(settingsPath)) return false;
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      packages?: Array<string | { source?: string }>;
      extensions?: string[];
    };
    const sources = [...(settings.packages ?? []), ...(settings.extensions ?? [])];
    return sources.some((s) => {
      const src = typeof s === 'string' ? s : s.source;
      return typeof src === 'string' && src.includes(ADAPTER_PACKAGE);
    });
  } catch {
    return false;
  }
}

/**
 * 从 adapter 状态快照提取 per-server 状态。快照结构未定型（Spike B 只确认了
 * per-server status/toolCount/disabled 存在），这里做防御式解析：支持
 * { servers: [...] } / { servers: {...} } / 顶层数组三种形态。
 */
function parseStatusSnapshot(): Map<string, PiMcpServerStatus> {
  const map = new Map<string, PiMcpServerStatus>();
  const snapshot = getLatestMcpStatusSnapshot();
  if (!snapshot || typeof snapshot !== 'object') return map;
  const raw: unknown = Array.isArray(snapshot)
    ? snapshot
    : (snapshot as { servers?: unknown }).servers;
  const entries: Array<[string, Record<string, unknown>]> = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        const name = typeof rec.name === 'string' ? rec.name : undefined;
        if (name) entries.push([name, rec]);
      }
    }
  } else if (raw && typeof raw === 'object') {
    for (const [name, value] of Object.entries(raw)) {
      if (value && typeof value === 'object') entries.push([name, value as Record<string, unknown>]);
    }
  }
  for (const [name, rec] of entries) {
    const status: PiMcpServerStatus = {};
    if (typeof rec.connected === 'boolean') status.connected = rec.connected;
    if (typeof rec.status === 'string') {
      status.raw = rec.status;
      status.connected ??= rec.status === 'connected';
    }
    if (typeof rec.toolCount === 'number') status.toolCount = rec.toolCount;
    if (typeof rec.disabled === 'boolean') status.disabled = rec.disabled;
    if (typeof rec.error === 'string') status.error = rec.error;
    map.set(name, status);
  }
  return map;
}

export const mcpApi = {
  list: async (_payload?: unknown, ctx?: HostActionContext): Promise<PiMcpListResult> => {
    const { agentDir, cwd } = await resolvePaths(ctx);
    const globalPath = path.join(agentDir, 'mcp.json');
    const projectPath = cwd ? path.join(cwd, '.mcp.json') : undefined;
    const statuses = parseStatusSnapshot();

    // project 覆盖同名 global（与 adapter 的优先级一致，docs §4.7）
    const merged = new Map<string, PiMcpServerRow>();
    for (const { name, config } of listServers(readMcpConfigFile(globalPath))) {
      merged.set(name, { name, scope: 'global', config, status: statuses.get(name) });
    }
    if (projectPath) {
      for (const { name, config } of listServers(readMcpConfigFile(projectPath))) {
        merged.set(name, { name, scope: 'project', config, status: statuses.get(name) });
      }
    }
    const servers = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
    return {
      servers,
      adapterInstalled: detectAdapter(agentDir),
      globalPath,
      projectPath,
    };
  },

  upsert: async (payload: PiMcpUpsertPayload, ctx?: HostActionContext): Promise<HostSuccess> => {
    const name = payload.name.trim();
    if (!name) return { success: false, error: 'empty name' };
    if (!payload.config.command && !payload.config.url) {
      return { success: false, error: 'command or url required' };
    }
    try {
      const { agentDir, cwd } = await resolvePaths(ctx);
      const filePath =
        payload.scope === 'project'
          ? cwd
            ? path.join(cwd, '.mcp.json')
            : null
          : path.join(agentDir, 'mcp.json');
      if (!filePath) return { success: false, error: 'no workspace for project scope' };
      const doc = readMcpConfigFile(filePath);
      // 编辑时保留壳不认识的字段（socket/auth/directTools 等）
      const base = doc.mcpServers?.[payload.originalName ?? name] ?? {};
      writeMcpConfigFile(
        filePath,
        upsertServer(doc, name, { ...base, ...payload.config }, payload.originalName),
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  remove: async (payload: PiMcpServerRefPayload, ctx?: HostActionContext): Promise<HostSuccess> => {
    try {
      const { agentDir, cwd } = await resolvePaths(ctx);
      const filePath =
        payload.scope === 'project' && cwd
          ? path.join(cwd, '.mcp.json')
          : path.join(agentDir, 'mcp.json');
      writeMcpConfigFile(filePath, removeServer(readMcpConfigFile(filePath), payload.name));
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  setDisabled: async (payload: PiMcpSetDisabledPayload, ctx?: HostActionContext): Promise<HostSuccess> => {
    try {
      const { agentDir, cwd } = await resolvePaths(ctx);
      const filePath =
        payload.scope === 'project' && cwd
          ? path.join(cwd, '.mcp.json')
          : path.join(agentDir, 'mcp.json');
      writeMcpConfigFile(
        filePath,
        setServerDisabled(readMcpConfigFile(filePath), payload.name, payload.disabled),
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: toError(err) };
    }
  },

  /** 一键安装 adapter：spawn 用户环境的 pi bin（路径来自检测，不硬编码）。 */
  installAdapter: async (): Promise<HostSuccess> => {
    const env = detectPiEnvironment();
    if (!env.pi.found || !env.pi.binPath) {
      return { success: false, error: 'pi not found' };
    }
    return new Promise((resolvePromise) => {
      const child = spawn(env.pi.binPath!, ['install', ADAPTER_SOURCE], {
        env: envWithUserPath(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout?.on('data', (d) => (output += String(d)));
      child.stderr?.on('data', (d) => (output += String(d)));
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolvePromise({ success: false, error: 'install timed out' });
      }, 180_000);
      child.on('error', (err) => {
        clearTimeout(timer);
        resolvePromise({ success: false, error: toError(err) });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolvePromise({ success: true });
        else resolvePromise({ success: false, error: output.trim().slice(-500) || `exit ${code}` });
      });
    });
  },
};
