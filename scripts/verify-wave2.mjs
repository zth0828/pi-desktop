// 波次2 新交互真实验证：发送四态/队列、工具三态文案、thinking 计时、/session、导航 rail
// 用法: PATH="$HOME/.npm-global/bin:$PATH" node scripts/verify-wave2.mjs
import electronBinaryPathImport from 'electron';
import { _electron as electron } from '@playwright/test';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join, resolve } from 'node:path';

const electronBinaryPath = electronBinaryPathImport;
const electronEntry = join(resolve(process.cwd()), 'dist-electron/main/index.js');
const realHome = process.env.HOME;
const shotDir = '/tmp/pi-lms-verify/shots-wave2';
const workspace = '/tmp/pi-lms-verify/workspace-wave2';

const homeDir = await mkdtemp(join(tmpdir(), 'pi-desktop-w2-home-'));
const agentDir = join(homeDir, 'agent');
await mkdir(agentDir, { recursive: true });
await mkdir(shotDir, { recursive: true });
await mkdir(workspace, { recursive: true });
await cp(join(realHome, '.pi/agent/models.json'), join(agentDir, 'models.json'));
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
const log = (...args) => console.log('[verify-w2]', ...args);
const streaming = async () => (await page.locator('.status-bar').count()) > 0;

async function waitDone(maxSeconds = 240) {
  for (let i = 0; i < maxSeconds / 2; i += 1) {
    await page.waitForTimeout(2_000);
    if (!(await streaming())) return true;
  }
  return false;
}

try {
  const input = page.getByTestId('chat-input');
  await input.waitFor({ state: 'visible', timeout: 30_000 });

  // 任务 1：多步任务制造流式窗口（write + edit + bash）
  await input.fill(
    'Use tools, no questions: 1) write notes.txt with three lines: one, two, three; ' +
    '2) edit notes.txt replacing two with TWO; 3) run `cat notes.txt` with bash; 4) one short sentence.',
  );
  await input.press('Enter');

  // 流式中：抓 Queue 按钮 + 入队一条 followUp
  let queued = false;
  for (let i = 0; i < 60; i += 1) {
    await page.waitForTimeout(1_000);
    if (await streaming()) {
      const queueBtn = page.getByTestId('chat-queue-send');
      if ((await queueBtn.count()) > 0 && !queued) {
        await input.fill('After that, say QUEUE-WORKS.');
        await queueBtn.click();
        await page.waitForTimeout(500);
        await shot('10-queued');
        log('queued followUp, queue items:', await page.locator('[data-testid^="queue-item-"]').count());
        queued = true;
      }
      if (queued && (await page.locator('.tool-line').count()) > 0) {
        await shot('11-running-toolline');
        break;
      }
    }
  }
  const done1 = await waitDone();
  await shot('12-done');
  const toolLines = await page.locator('.tool-line').allTextContents();
  log('phase1 done:', done1, 'tool lines:', JSON.stringify(toolLines.map((s) => s.slice(0, 60))));

  // /session 信息弹层
  await input.fill('/session');
  await input.press('Enter');
  await page.waitForTimeout(1_200);
  await shot('20-session-info');

  // /name 重命名 + 侧栏可见
  await input.fill('/name 波次二验证会话');
  await input.press('Enter');
  await page.waitForTimeout(1_200);
  await shot('21-renamed');

  // 多发几条 user 消息制造 rail 圆点
  for (const text of ['Say A only.', 'Say B only.']) {
    await input.fill(text);
    await input.press('Enter');
    await waitDone(120);
  }
  const railDots = await page.locator('.msg-rail-dot').count();
  await shot('30-rail');
  log('rail dots:', railDots);

  // 通知设置页三档开关
  await page.getByTestId('nav-settings').click().catch(() => {});
  await page.waitForTimeout(800);
  await shot('40-settings-notify');
  log('notes.txt:', (await import('node:fs')).existsSync(join(workspace, 'notes.txt'))
    ? JSON.stringify((await import('node:fs')).readFileSync(join(workspace, 'notes.txt'), 'utf8'))
    : 'missing');
} finally {
  await shot('99-teardown').catch(() => {});
  await app.close().catch(() => app.process().kill('SIGKILL'));
}
log('screenshots in', shotDir);
