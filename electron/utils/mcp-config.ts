// MCP 配置文件读写：标准 mcpServers 格式（pi-mcp-adapter 的配置，docs §4.7）。
// 壳只读写 <agentDir>/mcp.json 与 <cwd>/.mcp.json 两个文件；读整份 JSON、
// 只动 mcpServers 字段，其他字段原样保留。纯函数为主，便于单测。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PiMcpServerConfig } from '@shared/host-api/contract';

export type McpConfigDoc = {
  mcpServers?: Record<string, PiMcpServerConfig>;
} & Record<string, unknown>;

/** 读配置文件；文件不存在或 JSON 损坏时按空文档处理（损坏不覆盖，由写入方显式改）。 */
export function readMcpConfigFile(filePath: string): McpConfigDoc {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, 'utf8').trim();
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as McpConfigDoc;
}

export function writeMcpConfigFile(filePath: string, doc: McpConfigDoc): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`);
}

export function listServers(doc: McpConfigDoc): Array<{ name: string; config: PiMcpServerConfig }> {
  return Object.entries(doc.mcpServers ?? {}).map(([name, config]) => ({ name, config }));
}

/** 新增/编辑 server；originalName 与 name 不同视为重命名（删旧写新）。 */
export function upsertServer(
  doc: McpConfigDoc,
  name: string,
  config: PiMcpServerConfig,
  originalName?: string,
): McpConfigDoc {
  const servers = { ...(doc.mcpServers ?? {}) };
  if (originalName && originalName !== name) delete servers[originalName];
  servers[name] = config;
  return { ...doc, mcpServers: servers };
}

export function removeServer(doc: McpConfigDoc, name: string): McpConfigDoc {
  const servers = { ...(doc.mcpServers ?? {}) };
  delete servers[name];
  return { ...doc, mcpServers: servers };
}

export function setServerDisabled(doc: McpConfigDoc, name: string, disabled: boolean): McpConfigDoc {
  const current = doc.mcpServers?.[name];
  if (!current) return doc;
  const config = { ...current };
  if (disabled) config.disabled = true;
  else delete config.disabled;
  return { ...doc, mcpServers: { ...(doc.mcpServers ?? {}), [name]: config } };
}
