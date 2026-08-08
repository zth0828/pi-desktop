// 批次1+2 真实验证：聚合编辑卡、已处理折叠、新设置项
// 用法: PATH="$HOME/.npm-global/bin:$PATH" node scripts/verify-turnflow.mjs
import electronBinaryPathImport from 'electron';
import { _electron as electron } from '@playwright/test';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import path, { join, resolve } from 'node:path';

const electronBinaryPath = electronBinaryPathImport;
const electronEntry = join(resolve(process.cwd()), 'dist-electron/main/index.js');
const realHome = process.env.HOME;
const shotDir = '/tmp/pi-lms-verify/shots-turnflow';
const workspace = '/tmp/pi-lms-verify/workspace-turnflow';

const homeDir = await mkdtemp(join(tmpdir(), 'pi-desktop-tf-home-'));
const agentDir = join(homeDir, 'agent');
await mkdir(agentDir, { recursive: true });
await mkdir(shotDir, { recursive: true });
await mkdir(workspace, { recursive: true });
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
const shot = (name) => page.screenshot({ path: join(shotDir, `${name}.png`) });
const log = (...args) => console.log('[verify-tf]', ...args);

async function sendAndWait(text, maxSeconds = 240) {
  const input = page.getByTestId('chat-input');
  await input.fill(text);
  await input.press('Enter');
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
  await page.getByTestId('chat-input').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(3_000); // 等 start 完成（竞态修复已上，但留余量）

  // 第一轮：edit + write（聚合卡素材）
  await sendAndWait(
    'Use tools, no questions: 1) edit app.js changing `const version = 1;` to `const version = 2;`; ' +
    '2) create added.md with one line: hello; 3) reply with one short sentence.',
  );
  await page.waitForTimeout(1_000);
  await shot('10-turn1-card');
  const card = await page.locator('[data-testid="turn-changes"], .turn-changes').count();
  log('turn-changes card present:', card > 0);
  if (card > 0) {
    log('card text:', JSON.stringify((await page.locator('[data-testid="turn-changes"], .turn-changes').first().textContent())?.slice(0, 200)));
  }

  // 第二轮：纯文本回复（让第一轮成为历史轮 → 折叠为「已处理 Xs」）
  await sendAndWait('Reply with just: OK', 120);
  await page.waitForTimeout(800);
  await shot('20-worklog-collapsed');
  const worklog = await page.locator('[data-testid="work-log-row"]').count();
  log('work-log row present:', worklog > 0);

  // 设置页新设置项
  await page.getByTestId('nav-settings').click();
  await page.waitForTimeout(1_000);
  await shot('30-settings');
  const settingsText = await page.locator('body').innerText();
  for (const m of ['跟进', '休眠', '快捷键', '通知']) {
    log(`settings contains "${m}":`, settingsText.includes(m));
  }
  const fs = await import('node:fs');
  log('app.js:', JSON.stringify(fs.readFileSync(join(workspace, 'app.js'), 'utf8')));
  log('added.md exists:', fs.existsSync(join(workspace, 'added.md')));
} finally {
  await shot('99-teardown').catch(() => {});
  await app.close().catch(() => app.process().kill('SIGKILL'));
}
log('screenshots in', shotDir);
