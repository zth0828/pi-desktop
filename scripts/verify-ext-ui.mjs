// 真实扩展 UI 桥验证：confirm-destructive 官方示例扩展（新会话确认 + fork 选择）
// + 消息级 fork + 分支树，真实 LM Studio 模型驱动。
// 用法: PATH="$HOME/.npm-global/bin:$PATH" node scripts/verify-ext-ui.mjs
import electronBinaryPathImport from 'electron';
import { _electron as electron } from '@playwright/test';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join, resolve } from 'node:path';

const electronBinaryPath = electronBinaryPathImport;
const electronEntry = join(resolve(process.cwd()), 'dist-electron/main/index.js');
const realHome = process.env.HOME;
const shotDir = '/tmp/pi-lms-verify/shots-extui';
const workspace = '/tmp/pi-lms-verify/workspace-extui';

const homeDir = await mkdtemp(join(tmpdir(), 'pi-desktop-extui-home-'));
const agentDir = join(homeDir, 'agent');
await mkdir(join(agentDir, 'extensions/confirm-destructive'), { recursive: true });
await mkdir(shotDir, { recursive: true });
await mkdir(workspace, { recursive: true });
await cp(join(realHome, '.pi/agent/models.json'), join(agentDir, 'models.json'));
await cp(
  join(realHome, '.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/confirm-destructive.ts'),
  join(agentDir, 'extensions/confirm-destructive/index.ts'),
);
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
    PI_DESKTOP_NPM_ROOT: join(realHome, '.npm-global/lib/node_modules'),
    PI_DESKTOP_USER_DATA_DIR: join(homeDir, 'user-data'),
  },
  timeout: 60_000,
});

const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
const shot = (name) => page.screenshot({ path: join(shotDir, `${name}.png`) });
const log = (...args) => console.log('[verify-extui]', ...args);

async function waitRunDone(maxSeconds = 180) {
  let appeared = false;
  for (let i = 0; i < 15; i += 1) {
    await page.waitForTimeout(1_000);
    if ((await page.locator('.status-bar').count()) > 0) { appeared = true; break; }
  }
  if (!appeared) log('warn: status-bar never appeared');
  for (let i = 0; i < maxSeconds / 2; i += 1) {
    await page.waitForTimeout(2_000);
    if ((await page.locator('.status-bar').count()) === 0) return true;
  }
  return false;
}

async function send(text) {
  const input = page.getByTestId('chat-input');
  await input.waitFor({ state: 'visible', timeout: 30_000 });
  await input.fill(text);
  await input.press('Enter');
  await waitRunDone();
}

const userMessages = () => page.getByTestId('message-user').count();

try {
  // 两轮对话，制造可 fork 的历史
  await send('Say PONG only.');
  await send('Say DONE only.');
  log('two turns done, user messages:', await userMessages());

  // 1) confirm：新会话被扩展拦截 → 取消
  await page.getByTestId('new-chat').click();
  const dialog = page.getByTestId('extui-dialog');
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  log('confirm dialog kind:', await dialog.getAttribute('data-kind'));
  await shot('10-confirm-clear');
  await page.getByTestId('extui-cancel').click();
  await page.waitForTimeout(800);
  log('after cancel, user messages still:', await userMessages());

  // 2) fork：hover 第二条 user 消息 → fork 按钮 → 扩展 select 对话框 → 确认分叉
  const second = page.getByTestId('message-user').nth(1);
  await second.hover();
  const forkBtn = second.getByTestId('fork-message');
  await forkBtn.waitFor({ state: 'visible', timeout: 5_000 });
  await forkBtn.click();
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  log('fork dialog kind:', await dialog.getAttribute('data-kind'));
  await shot('20-fork-select');
  await page.getByTestId('extui-option').first().click(); // "Yes, create fork"
  await page.waitForTimeout(2_000);
  log('after fork, user messages:', await userMessages(), '(应为 1)');
  log('input draft:', JSON.stringify(await page.getByTestId('chat-input').inputValue()));
  await shot('21-after-fork');

  // 3) 分支树面板
  await send('Say BRANCH only.');
  await page.getByTestId('open-tree').click();
  await page.waitForTimeout(1_000);
  await shot('30-tree');
  log('tree nodes:', await page.locator('[data-testid^="tree-node"], .tree-node').count());
} finally {
  await shot('99-teardown').catch(() => {});
  await app.close().catch(() => app.process().kill('SIGKILL'));
}
log('screenshots in', shotDir);
