// Review 面板真实验证：git repo workspace + 真实模型改文件 → 面板 → 回滚
// 用法: PATH="$HOME/.npm-global/bin:$PATH" node scripts/verify-review.mjs
import electronBinaryPathImport from 'electron';
import { _electron as electron } from '@playwright/test';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import path, { join, resolve } from 'node:path';

const electronBinaryPath = electronBinaryPathImport;
const electronEntry = join(resolve(process.cwd()), 'dist-electron/main/index.js');
const realHome = process.env.HOME;
const shotDir = '/tmp/pi-lms-verify/shots-review';
const workspace = '/tmp/pi-lms-verify/workspace-review';

const homeDir = await mkdtemp(join(tmpdir(), 'pi-desktop-review-home-'));
const agentDir = join(homeDir, 'agent');
await mkdir(agentDir, { recursive: true });
await mkdir(shotDir, { recursive: true });
await mkdir(workspace, { recursive: true });
// git workspace：一个已跟踪文件
await writeFile(join(workspace, 'app.js'), 'const version = 1;\n');
const git = (args) => execFileSync('git', args, { cwd: workspace, stdio: 'pipe' });
git(['init']); git(['add', '.']); git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init']);

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
// 主进程日志直通，定位 session 启动失败原因
app.process().stdout?.on('data', (d) => console.log('[main:out]', String(d).trim()));
app.process().stderr?.on('data', (d) => console.log('[main:err]', String(d).trim()));
const shot = (name) => page.screenshot({ path: join(shotDir, `${name}.png`) });
const log = (...args) => console.log('[verify-review]', ...args);

async function waitDone(maxSeconds = 240) {
  for (let i = 0; i < 15; i += 1) {
    await page.waitForTimeout(1_000);
    if ((await page.locator('.status-bar').count()) > 0) break;
  }
  for (let i = 0; i < maxSeconds / 2; i += 1) {
    await page.waitForTimeout(2_000);
    if ((await page.locator('.status-bar').count()) === 0) return true;
  }
  return false;
}

try {
  const input = page.getByTestId('chat-input');
  await input.waitFor({ state: 'visible', timeout: 30_000 });
  // 先等 start 完成，抓启动阶段的真实错误（发送前的 banner）
  await page.waitForTimeout(8_000);
  const banner = await page.locator('.error-banner').allTextContents().catch(() => []);
  log('pre-send banners:', JSON.stringify(banner.filter((s) => s.trim())));
  const state0 = await page.evaluate(() => (window).__chatStoreDebug ?? null).catch(() => null);
  log('debug state:', JSON.stringify(state0));
  await input.fill(
    'Use tools, no questions: 1) edit app.js changing `const version = 1;` to `const version = 2;`; ' +
    '2) create new-file.md with one line: added by agent; 3) reply with one short sentence.',
  );
  await input.press('Enter');
  const done = await waitDone();
  log('run done:', done);

  await page.getByTestId('open-review').click();
  await page.waitForTimeout(1_500);
  await shot('10-review-panel');
  const files = await page.getByTestId('review-file').allTextContents();
  log('review files:', JSON.stringify(files));

  // 回滚 new-file.md（文件级）
  const newFileRow = page.locator('[data-testid="review-file"]:has-text("new-file.md")').first();
  if (await newFileRow.count()) {
    await newFileRow.hover();
    await newFileRow.getByTestId('revert-file').click().catch((e) => log('revert click fail:', e.message));
    await page.waitForTimeout(600);
    await shot('20-revert-confirm');
    await page.getByTestId('review-confirm-ok').click().catch((e) => log('confirm click fail:', e.message));
    await page.waitForTimeout(1_200);
    await shot('21-after-revert');
  } else {
    log('new-file.md row not found');
  }
  const fs = await import('node:fs');
  log('new-file.md exists after revert:', fs.existsSync(join(workspace, 'new-file.md')), '(应为 false)');
  log('app.js content:', JSON.stringify(fs.readFileSync(join(workspace, 'app.js'), 'utf8')));
} finally {
  await shot('99-teardown').catch(() => {});
  await app.close().catch(() => app.process().kill('SIGKILL'));
}
log('screenshots in', shotDir);
