// 探针：复刻壳的运行时创建路径，列出会话激活工具，验证扩展工具（subagent）在壳里可用。
// 用法: PATH="$HOME/.npm-global/bin:$PATH" PI_CODING_AGENT_DIR=<agentDir> node scripts/probe-tools.mjs [agentDir]
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const agentDir = process.argv[2];
if (agentDir) process.env.PI_CODING_AGENT_DIR = agentDir;

const pkgRoot = join(process.env.HOME, '.npm-global/lib/node_modules/@earendil-works/pi-coding-agent');
const { readFileSync } = await import('node:fs');
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
const entry = pkg.exports?.['.']?.import ?? pkg.main;
const sdk = await import(pathToFileURL(join(pkgRoot, entry)).href);

const cwd = '/tmp/pi-lms-verify/workspace-full';
const services = await sdk.createAgentSessionServices({ cwd, agentDir: sdk.getAgentDir() });
const result = await sdk.createAgentSessionFromServices({
  services,
  sessionManager: sdk.SessionManager.create(cwd),
});
const session = result.session;
await session.bindExtensions({ mode: 'print' });

const names = session.getActiveToolNames ? session.getActiveToolNames() : '(no getActiveToolNames)';
console.log('active tools:', JSON.stringify(names));
const all = session.getAllTools ? session.getAllTools().map((t) => `${t.name}(${t.source?.type ?? t.source ?? '?'})`) : [];
console.log('all registered tools:', JSON.stringify(all));
// 调试：扩展加载情况
const loader = services.resourceLoader ?? services.loader;
if (loader?.getExtensions) {
  const exts = loader.getExtensions();
  console.log('extensions raw:', JSON.stringify(exts).slice(0, 1500));
} else {
  console.log('services keys:', Object.keys(services).join(','), loader ? Object.keys(loader).join(',') : 'no-loader');
}
console.log('extension diagnostics:', JSON.stringify(services.diagnostics ?? null));
process.exit(0);
