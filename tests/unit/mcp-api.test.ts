// mcpApi 服务层单测：project scope 丢失 cwd 时不得回退写 global 配置。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../electron/services/pi-adapter', () => ({
  loadPiAdapter: vi.fn(),
}));
vi.mock('../../electron/services/pi-runtime-api', () => ({
  getLatestMcpStatusSnapshot: vi.fn(() => null),
  resolveRuntimeForContext: vi.fn(() => null),
}));
vi.mock('../../electron/services/settings-api', () => ({
  settingsApi: { get: vi.fn(), set: vi.fn() },
}));

const { loadPiAdapter } = await import('../../electron/services/pi-adapter');
const { settingsApi } = await import('../../electron/services/settings-api');
const { mcpApi } = await import('../../electron/services/mcp-api');

let agentDir: string;

beforeEach(() => {
  agentDir = mkdtempSync(path.join(tmpdir(), 'pi-desktop-mcp-api-'));
  vi.mocked(loadPiAdapter).mockResolvedValue({
    paths: { getAgentDir: () => agentDir },
  } as Awaited<ReturnType<typeof loadPiAdapter>>);
  vi.mocked(settingsApi.get).mockResolvedValue(undefined);
});

afterEach(() => {
  rmSync(agentDir, { recursive: true, force: true });
});

describe('mcpApi remove/setDisabled 的 scope 回退防护', () => {
  it('project scope 无 cwd：remove 失败且不碰 global mcp.json', async () => {
    const globalFile = path.join(agentDir, 'mcp.json');
    const before = JSON.stringify({ mcpServers: { keep: { command: 'run' } } });
    writeFileSync(globalFile, before);

    const result = await mcpApi.remove({ scope: 'project', name: 'keep' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('no workspace for project scope');
    // global 配置原样：没有静默删除同名 server
    expect(readFileSync(globalFile, 'utf8')).toBe(before);
  });

  it('project scope 无 cwd：setDisabled 失败且不碰 global mcp.json', async () => {
    const globalFile = path.join(agentDir, 'mcp.json');
    const before = JSON.stringify({ mcpServers: { keep: { command: 'run' } } });
    writeFileSync(globalFile, before);

    const result = await mcpApi.setDisabled({ scope: 'project', name: 'keep', disabled: true });

    expect(result.success).toBe(false);
    expect(result.error).toBe('no workspace for project scope');
    expect(readFileSync(globalFile, 'utf8')).toBe(before);
  });

  it('project scope 有 cwd：正常删项目 .mcp.json，global 不受影响', async () => {
    const globalFile = path.join(agentDir, 'mcp.json');
    const workspace = mkdtempSync(path.join(tmpdir(), 'pi-desktop-mcp-ws-'));
    try {
      writeFileSync(globalFile, JSON.stringify({ mcpServers: { keep: { command: 'run' } } }));
      writeFileSync(path.join(workspace, '.mcp.json'), JSON.stringify({ mcpServers: { tmp: { command: 'x' } } }));
      vi.mocked(settingsApi.get).mockResolvedValue(workspace);

      const result = await mcpApi.remove({ scope: 'project', name: 'tmp' });

      expect(result.success).toBe(true);
      const project = JSON.parse(readFileSync(path.join(workspace, '.mcp.json'), 'utf8'));
      expect(project.mcpServers).toEqual({});
      expect(JSON.parse(readFileSync(globalFile, 'utf8')).mcpServers.keep).toEqual({ command: 'run' });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('global scope 无 cwd：正常删 global mcp.json', async () => {
    const globalFile = path.join(agentDir, 'mcp.json');
    writeFileSync(globalFile, JSON.stringify({ mcpServers: { old: { command: 'run' }, keep: { command: 'y' } } }));

    const result = await mcpApi.remove({ scope: 'global', name: 'old' });

    expect(result.success).toBe(true);
    const global = JSON.parse(readFileSync(globalFile, 'utf8'));
    expect(Object.keys(global.mcpServers)).toEqual(['keep']);
  });
});
