// 综合功能验证：真实 LM Studio 模型驱动桌面端，覆盖全工具马拉松 / 图片上传 /
// subagent 扩展 / @文件引用。截图输出到 /tmp/pi-lms-verify/shots-full/。
// 用法: PATH="$HOME/.npm-global/bin:$PATH" node scripts/verify-full.mjs
import electronBinaryPathImport from 'electron';
import { _electron as electron } from '@playwright/test';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join, resolve } from 'node:path';

const electronBinaryPath = electronBinaryPathImport;
const repoRoot = resolve(process.cwd());
const electronEntry = join(repoRoot, 'dist-electron/main/index.js');
const realHome = process.env.HOME;
const shotDir = '/tmp/pi-lms-verify/shots-full';
const workspace = '/tmp/pi-lms-verify/workspace-full';
const testImage = '/tmp/pi-lms-verify/test-image.png';

const homeDir = await mkdtemp(join(tmpdir(), 'pi-desktop-full-home-'));
const agentDir = join(homeDir, 'agent');
await mkdir(agentDir, { recursive: true });
await mkdir(shotDir, { recursive: true });
await mkdir(workspace, { recursive: true });
await cp(join(realHome, '.pi/agent/models.json'), join(agentDir, 'models.json'));
await cp(join(realHome, '.pi/agent/agents'), join(agentDir, 'agents'), { recursive: true });
await cp(join(realHome, '.pi/agent/prompts'), join(agentDir, 'prompts'), { recursive: true });
// subagent 扩展：复制用户配置里的补丁版（PI_CLI_PATH 兼容 Electron spawn）
await mkdir(join(agentDir, 'extensions/subagent'), { recursive: true });
const subExt = join(realHome, '.pi/agent/extensions/subagent');
await cp(join(subExt, 'index.ts'), join(agentDir, 'extensions/subagent/index.ts'));
await cp(join(subExt, 'agents.ts'), join(agentDir, 'extensions/subagent/agents.ts'));
// 示例 agent 定义里写死 claude-haiku-4-5，本地只有 lmstudio —— 去掉 model 行让其回退默认模型
const { readdirSync, readFileSync, writeFileSync } = await import('node:fs');
for (const f of readdirSync(join(agentDir, 'agents'))) {
  const p = join(agentDir, 'agents', f);
  writeFileSync(p, readFileSync(p, 'utf8').split('\n').filter((l) => !l.startsWith('model:')).join('\n'));
}
await writeFile(
  join(agentDir, 'settings.json'),
  JSON.stringify({
    defaultProvider: 'lmstudio',
    defaultModel: 'qwen/qwen3.5-9b',
    packages: [
      join(realHome, '.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/subagent'),
    ],
  }),
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
const shot = (name) => page.screenshot({ path: join(shotDir, `${name}.png`), fullPage: false });
const log = (...args) => console.log('[verify]', ...args);

const selectModel = async (page, value) => {
  await page.getByTestId('model-select').click();
  await page.getByTestId('model-menu-models').click();
  await page.locator(`[data-testid="model-option"][data-value="${value}"]`).click();
};

async function waitRunDone(maxSeconds = 240) {
  // 先等状态条出现（防止 Enter 后轮询太快误判已完成），再等它消失
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
}

try {
  const phases = (process.env.PHASES ?? '1,2,3,4').split(',').map((s) => s.trim());
  // ---------- Phase 1: 全工具马拉松（write/read/edit/grep/find/ls/bash） ----------
  if (phases.includes('1')) {
  await page.getByTestId('chat-input').waitFor({ state: 'visible', timeout: 30_000 });
  await send(
    'Do ALL of these steps with tools, no questions, in order: ' +
    '1) use write to create fruits.txt with exactly three lines: apple, banana, cherry; ' +
    '2) use read on fruits.txt; ' +
    '3) use edit to replace banana with blueberry in fruits.txt; ' +
    '4) use grep for "berry" in the current directory; ' +
    '5) use find to list .txt files; ' +
    '6) use the ls tool on the current directory; ' +
    '7) run `wc -l fruits.txt` with bash; ' +
    'then reply with one short sentence.',
  );
  const done1 = await waitRunDone(300);
  await shot('10-marathon');
  const toolNames = await page.locator('.tool-name').allTextContents();
  log('phase1 done:', done1, 'tools used:', JSON.stringify(toolNames));
  }

  // ---------- Phase 2: 图片上传（切 GLM 4.6V 视觉模型） ----------
  if (phases.includes('2')) {
  await page.getByTestId('new-chat').click();
  await page.getByTestId('model-select').waitFor({ state: 'visible', timeout: 30_000 });
  await selectModel(page, 'lmstudio/zai-org/glm-4.6v-flash');
  log('phase2 model switched:', await page.getByTestId('model-select').getAttribute('data-value'));
  await page.locator('input[type="file"]').setInputFiles(testImage);
  await page.waitForTimeout(1_000);
  await shot('20-image-attached');
  await send('What is in this image? Answer in one short sentence.');
  const done2 = await waitRunDone(300);
  await shot('21-image-result');
  const reply2 = await page.locator('.message-assistant, [class*="assistant"]').last().textContent().catch(() => '');
  log('phase2 done:', done2, 'reply:', (reply2 ?? '').slice(0, 200));
  }

  // ---------- Phase 3: subagent 扩展（prompt 模板 /scout-and-plan 强制走 subagent 链） ----------
  if (phases.includes('3')) {
  await page.getByTestId('new-chat').click();
  await page.getByTestId('model-select').waitFor({ state: 'visible', timeout: 30_000 });
  await selectModel(page, 'lmstudio/qwen/qwen3.5-9b');
  await send('/scout-and-plan list the files in the current directory');
  const done3 = await waitRunDone(420);
  // 展开 subagent 卡片看聚合结果
  const subagentCard = page.locator('[class*="tool"]:has-text("subagent")').first();
  if (await subagentCard.count()) await subagentCard.click().catch(() => {});
  await page.waitForTimeout(500);
  await shot('30-subagent');
  const names3 = await page.locator('.tool-name').allTextContents();
  log('phase3 done:', done3, 'tools used:', JSON.stringify(names3));
  }

  // ---------- Phase 4: @ 文件引用 ----------
  if (phases.includes('4')) {
  await page.getByTestId('new-chat').click();
  const input4 = page.getByTestId('chat-input');
  await input4.waitFor({ state: 'visible', timeout: 30_000 });
  await input4.pressSequentially('@fruits', { delay: 80 });
  const fileOption = page.getByTestId('file-option').first();
  await fileOption.waitFor({ state: 'visible', timeout: 10_000 });
  await shot('40-at-panel');
  await fileOption.click();
  await input4.pressSequentially(' what is on line 2 of this file? One word.', { delay: 20 });
  await input4.press('Enter');
  const done4 = await waitRunDone(180);
  await shot('41-at-result');
  const reply4 = await page.locator('[data-testid="message-assistant"], .message-assistant').last().textContent().catch(() => '');
  log('phase4 done:', done4, 'reply:', (reply4 ?? '').slice(0, 200));
  }

  log('workspace files:', (await import('node:fs')).readdirSync(workspace).join(', '));
  try {
    log('fruits.txt:', JSON.stringify((await import('node:fs')).readFileSync(join(workspace, 'fruits.txt'), 'utf8')));
  } catch { log('fruits.txt missing'); }
} finally {
  await shot('99-teardown').catch(() => {});
  await app.close().catch(() => app.process().kill('SIGKILL'));
}
log('screenshots in', shotDir);
