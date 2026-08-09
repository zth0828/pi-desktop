// 图片上传单点验证（修复 payload 结构后重验）
// 用法: PATH="$HOME/.npm-global/bin:$PATH" node scripts/verify-image.mjs
import electronBinaryPathImport from 'electron';
import { _electron as electron } from '@playwright/test';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join, resolve } from 'node:path';

const electronBinaryPath = electronBinaryPathImport;
const electronEntry = join(resolve(process.cwd()), 'dist-electron/main/index.js');
const realHome = process.env.HOME;
const shotDir = '/tmp/pi-lms-verify/shots-full';
const workspace = '/tmp/pi-lms-verify/workspace-img';
const testImage = '/tmp/pi-lms-verify/test-image.png';

const homeDir = await mkdtemp(join(tmpdir(), 'pi-desktop-img-home-'));
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
const log = (...args) => console.log('[verify-img]', ...args);

try {
  const input = page.getByTestId('chat-input');
  await input.waitFor({ state: 'visible', timeout: 30_000 });
  log('model:', await page.getByTestId('model-select').inputValue().catch(() => '?'));
  await page.locator('input[type="file"]').setInputFiles(testImage);
  await page.waitForTimeout(800);
  await input.fill('What is in this image? Answer in one short sentence.');
  await input.press('Enter');
  for (let i = 0; i < 120; i += 1) {
    await page.waitForTimeout(2_000);
    if ((await page.locator('.status-bar').count()) === 0 && i > 2) break;
  }
  await page.screenshot({ path: join(shotDir, '40-image-fixed.png') });
  const reply = await page.locator('[data-testid="message-assistant"], .message-assistant').last().textContent().catch(() => '(none)');
  log('reply:', (reply ?? '').slice(0, 300));
} finally {
  await app.close().catch(() => app.process().kill('SIGKILL'));
}
