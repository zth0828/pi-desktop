// mcp-config helpers 单测：读写 <agentDir>/mcp.json / .mcp.json 的纯函数层。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listServers,
  readMcpConfigFile,
  removeServer,
  setServerDisabled,
  upsertServer,
  writeMcpConfigFile,
} from '../../electron/utils/mcp-config';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pi-desktop-mcp-config-'));
  file = path.join(dir, 'mcp.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('mcp-config', () => {
  it('文件不存在时读为空文档', () => {
    expect(readMcpConfigFile(file)).toEqual({});
    expect(listServers(readMcpConfigFile(file))).toEqual([]);
  });

  it('upsert 新增 server 并保留文件里其他字段', () => {
    writeFileSync(file, JSON.stringify({ theme: 'dark', mcpServers: { a: { command: 'x' } } }));
    const doc = upsertServer(readMcpConfigFile(file), 'b', { url: 'http://localhost:1' });
    writeMcpConfigFile(file, doc);
    const written = JSON.parse(readFileSync(file, 'utf8'));
    expect(written.theme).toBe('dark');
    expect(written.mcpServers.a).toEqual({ command: 'x' });
    expect(written.mcpServers.b).toEqual({ url: 'http://localhost:1' });
  });

  it('upsert 带 originalName 视为重命名', () => {
    const doc = upsertServer(
      { mcpServers: { old: { command: 'run', disabled: true } } },
      'new',
      { command: 'run' },
      'old',
    );
    expect(doc.mcpServers?.old).toBeUndefined();
    expect(doc.mcpServers?.new).toEqual({ command: 'run' });
  });

  it('setServerDisabled 切换 disabled 字段', () => {
    const base = { mcpServers: { s: { command: 'run' } } };
    const disabled = setServerDisabled(base, 's', true);
    expect(disabled.mcpServers?.s.disabled).toBe(true);
    const enabled = setServerDisabled(disabled, 's', false);
    expect(enabled.mcpServers?.s).toEqual({ command: 'run' });
    // 不存在的 server：原样返回
    expect(setServerDisabled(base, 'nope', true)).toBe(base);
  });

  it('removeServer 删除且不碰其他 server', () => {
    const doc = removeServer(
      { mcpServers: { a: { command: 'x' }, b: { command: 'y' } } },
      'a',
    );
    expect(Object.keys(doc.mcpServers ?? {})).toEqual(['b']);
  });

  it('writeMcpConfigFile 自动创建父目录', () => {
    const nested = path.join(dir, 'sub', 'deep', 'mcp.json');
    writeMcpConfigFile(nested, { mcpServers: { s: { command: 'run' } } });
    expect(listServers(readMcpConfigFile(nested))).toEqual([{ name: 's', config: { command: 'run' } }]);
  });
});
