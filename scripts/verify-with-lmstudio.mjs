// 手动验证脚本：用真实 LM Studio 本地模型驱动桌面端 UI，截图验证执行过程渲染。
// 用法: PATH="$HOME/.npm-global/bin:$PATH" node scripts/verify-with-lmstudio.mjs
import electronBinaryPathImport from 'electron';
import { _electron as electron } from '@playwright/test';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join, resolve } from 'node:path';

const electronBinaryPath = electronBinaryPathImport;
const repoRoot = resolve(process.cwd());
const electronEntry = join(repoRoot, 'dist-electron/main/index.js');
const shotDir = '/tmp/pi-lms-verify/shots';
const workspace = '/tmp/pi-lms-verify/workspace';

const homeDir = await mkdtemp(join(tmpdir(), 'pi-desktop-verify-home-'));
const agentDir = join(homeDir, 'agent');
await mkdir(agentDir, { recursive: true });
await mkdir(shotDir, { recursive: true });
await mkdir(workspace, { recursive: true });
// 复用真实 pi 配置里的 lmstudio 供应商，但会话隔离在临时目录
await cp(join(process.env.HOME, '.pi/agent/models.json'), join(agentDir, 'models.json'));
await writeFile(
  join(agentDir, 'settings.json'),
  JSON.stringify({ defaultProvider: 'lmstudio', defaultModel: 'qwen/qwen3.5-9b' }),
);
await mkdir(join(homeDir, 'user-data'), { recursive: true });
await writeFile(join(homeDir, 'user-data/config.json'), JSON.stringify({ workspaceCwd: workspace }));

const app = await electron.launch({
  executablePath: electronBinaryPath,
  args: ['--lang=zh-CN', electronEntry],
  env: {
    ...process.env,
    HOME: homeDir,
    PI_CODING_AGENT_DIR: agentDir,
    PI_DESKTOP_NPM_ROOT: join(process.env.HOME, '.npm-global/lib/node_modules'),
    PI_DESKTOP_USER_DATA_DIR: join(homeDir, 'user-data'),
  },
  timeout: 60_000,
});

const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');

const shot = (name) => page.screenshot({ path: join(shotDir, `${name}.png`) });
const log = (...args) => console.log('[verify]', ...args);

try {
  const input = page.getByTestId('chat-input');
  await input.waitFor({ state: 'visible', timeout: 30_000 });
  log('chat ready, model:', await page.getByTestId('model-select').inputValue().catch(() => '(no select)'));

  await input.fill(
    'Do these steps with tools, no questions: ' +
    '1) run `ls -la` with the bash tool; ' +
    '2) create hello.txt with exactly one line: hello; ' +
    '3) use the edit tool to replace "hello" with "hello world" in hello.txt; ' +
    '4) reply with one short sentence.',
  );
  await input.press('Enter');
  log('prompt sent');

  // 执行中抓状态条/流式工具卡；结束判定 = 状态条消失
  let capturedWorking = false;
  for (let i = 0; i < 150; i += 1) {
    await page.waitForTimeout(2_000);
    const statusBars = await page.locator('.status-bar').count();
    if (!capturedWorking && statusBars > 0) {
      await shot('01-working');
      capturedWorking = true;
      log('captured working status');
    }
    if (i === 15) await shot('02-midrun');
    if (capturedWorking && statusBars === 0) {
      log('run finished after ~%ds', i * 2);
      break;
    }
  }
  await shot('03-final');

  const stats = {
    toolCards: await page.locator('[class*="tool"]').count(),
    diffAdd: await page.locator('.diff-add').count(),
    diffDel: await page.locator('.diff-del').count(),
    thinking: await page.locator('.thinking-block, [class*="thinking"]').count(),
    statusBar: await page.locator('.status-bar').count(),
  };
  log('render stats:', JSON.stringify(stats));
  log('workspace files:', (await import('node:fs')).readdirSync(workspace).join(', '));
  try {
    log('hello.txt:', (await import('node:fs')).readFileSync(join(workspace, 'hello.txt'), 'utf8'));
  } catch { log('hello.txt missing'); }
} finally {
  await shot('99-teardown').catch(() => {});
  await app.close().catch(() => app.process().kill('SIGKILL'));
}
log('screenshots in', shotDir);
