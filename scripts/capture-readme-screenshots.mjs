import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import electronBinaryPath from 'electron';
import { _electron as electron } from '@playwright/test';

const root = process.cwd();
const outputDir = path.join(root, 'resources/screenshots');
const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'pi-desktop-readme-'));
const agentDir = path.join(fixtureRoot, 'agent');
const userDataDir = path.join(fixtureRoot, 'user-data');
const workspace = path.join(fixtureRoot, 'pi-desktop-demo');
const mock = spawn(process.execPath, [path.join(root, 'tests/fixtures/mock-openai-server.mjs')]);
const catalog = spawn(
  process.execPath,
  [path.join(root, 'tests/fixtures/mock-package-catalog-server.mjs')],
  { env: { ...process.env, PI_CATALOG_README_DEMO: '1' } },
);
let app;

async function mockPort() {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('mock provider did not start')), 10_000);
    mock.stdout.on('data', (data) => {
      const match = String(data).match(/MOCK_PORT=(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(Number(match[1]));
    });
    mock.once('exit', (code) => reject(new Error(`mock provider exited with ${code}`)));
  });
}

async function catalogUrl() {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('mock package catalog did not start')), 10_000);
    catalog.stdout.on('data', (data) => {
      const match = String(data).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[0]);
    });
    catalog.once('exit', (code) => reject(new Error(`mock package catalog exited with ${code}`)));
  });
}

try {
  const [port, packageCatalogUrl] = await Promise.all([mockPort(), catalogUrl()]);
  await mkdir(agentDir, { recursive: true });
  await mkdir(userDataDir, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(workspace, 'release-notes.md'), '# Release notes\n\n- Streaming chat\n- Workspace review\n');
  await writeFile(path.join(workspace, 'release-status.txt'), 'status: alpha\nchannel: preview\n');
  await mkdir(path.join(workspace, 'docs'), { recursive: true });
  await writeFile(path.join(workspace, 'docs', 'design.md'), '# Design\n\nWorkbench panels stay docked beside the chat.\n');
  await writeFile(path.join(workspace, 'docs', 'rollout.md'), '# Rollout\n\n1. Preview builds\n2. Signed releases\n');
  execFileSync('git', ['init', '--quiet'], { cwd: workspace });
  execFileSync('git', ['add', '.'], { cwd: workspace });
  execFileSync('git', [
    '-c', 'user.name=Pi Desktop',
    '-c', 'user.email=demo@localhost',
    'commit', '--quiet', '-m', 'demo baseline',
  ], { cwd: workspace });
  await writeFile(path.join(agentDir, 'models.json'), JSON.stringify({
    providers: {
      'openai-compatible': {
        baseUrl: `http://127.0.0.1:${port}/v1`,
        api: 'openai-completions',
        apiKey: 'local-demo-key',
        models: [{
          id: 'pi-code',
          name: 'Pi Code',
          reasoning: false,
          input: ['text', 'image'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 16384,
        }],
      },
      'local-studio': {
        baseUrl: `http://127.0.0.1:${port}/v1`,
        api: 'openai-completions',
        apiKey: 'local-demo-key',
        models: [{
          id: 'qwen3-coder-30b',
          name: 'Qwen3 Coder 30B',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 262144,
          maxTokens: 32768,
        }, {
          id: 'deepseek-r1-distill',
          name: 'DeepSeek R1 Distill',
          reasoning: true,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 131072,
          maxTokens: 16384,
        }, {
          id: 'glm-4.6-air',
          name: 'GLM 4.6 Air',
          reasoning: true,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 131072,
          maxTokens: 16384,
        }, {
          id: 'kimi-k2-instruct',
          name: 'Kimi K2 Instruct',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 262144,
          maxTokens: 16384,
        }, {
          id: 'llama3.3-70b',
          name: 'Llama 3.3 70B',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 131072,
          maxTokens: 8192,
        }, {
          id: 'mistral-large-3',
          name: 'Mistral Large 3',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 131072,
          maxTokens: 8192,
        }],
      },
    },
  }));
  await writeFile(path.join(agentDir, 'settings.json'), JSON.stringify({
    defaultProvider: 'openai-compatible',
    defaultModel: 'pi-code',
  }));
  await writeFile(path.join(userDataDir, 'config.json'), JSON.stringify({
    workspaceCwd: workspace,
    language: 'en',
  }));

  const nodeBin = path.dirname(process.execPath);
  app = await electron.launch({
    executablePath: electronBinaryPath,
    args: [path.join(root, 'dist-electron/main/index.js')],
    env: {
      ...process.env,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      PI_DESKTOP_E2E: '1',
      PI_DESKTOP_USER_DATA_DIR: userDataDir,
      PI_DESKTOP_USER_PATH: `${nodeBin}:/usr/local/bin:/usr/bin:/bin`,
      PI_DESKTOP_DEV_ALLOW_NON_NPM: '1',
      PI_DESKTOP_DEV_PI_PACKAGE_ROOT: path.join(root, 'node_modules/@earendil-works/pi-coding-agent'),
      PI_CODING_AGENT_DIR: agentDir,
      PI_PACKAGE_CATALOG_URL: `${packageCatalogUrl}/packages`,
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('model-select').or(page.getByTestId('model-badge')).first().waitFor({ timeout: 30_000 });

  await page.getByTestId('chat-input').fill('Create a concise release plan for Pi Desktop.');
  await page.getByTestId('chat-send').click();
  await page.getByText('Release plan', { exact: true }).waitFor({ timeout: 30_000 });
  await page.screenshot({ path: path.join(outputDir, 'chat.png') });

  await page.getByTestId('chat-input').fill('Please update the release status from alpha to beta.');
  await page.getByTestId('chat-send').click();
  await page.getByTestId('turn-fold-toggle').last().waitFor({ timeout: 30_000 });
  await page.getByTestId('workspace-toggle').click();
  await page.getByTestId('workspace-review-tab').click();
  await page.getByText('release-status.txt', { exact: true }).first().waitFor({ timeout: 30_000 });
  await page.screenshot({ path: path.join(outputDir, 'review.png') });

  await page.getByTestId('composer-menu').click();
  await page.getByTestId('composer-command-mode').click();
  await page.getByTestId('chat-input').fill('git log --oneline --decorate -3');
  await page.getByTestId('chat-send').click();
  await page.getByTestId('workspace-commands-tab').click();
  await page.getByTestId('command-run-toggle').first().waitFor({ timeout: 30_000 });
  await page.getByTestId('command-run-toggle').first().click();
  await page.locator('.command-run.expanded').getByTestId('command-run-output').waitFor({ timeout: 30_000 });
  await page.screenshot({ path: path.join(outputDir, 'commands.png') });

  await page.getByTestId('nav-models').click();
  await page.getByTestId('models-search').fill('openai-compatible');
  await page.getByTestId('provider-openai-compatible').waitFor({ timeout: 30_000 });
  await page.getByTestId('provider-openai-compatible').locator('.provider-row-header').click();
  await page.getByTestId('provider-model-openai-compatible-pi-code').waitFor();
  await page.screenshot({ path: path.join(outputDir, 'models.png') });

  await page.getByTestId('new-chat').click();
  await page.getByTestId('chat-input').fill('Review the release checklist.');
  await page.getByTestId('chat-send').click();
  await page.getByTestId('message-assistant').last().waitFor({ timeout: 30_000 });
  await page.getByTestId('nav-sessions').click();
  await page.locator('.session-row').nth(1).waitFor({ timeout: 30_000 });
  await page.addStyleTag({ content: '.session-export-status { display: none !important; }' });
  await page.screenshot({ path: path.join(outputDir, 'sessions.png') });

  // 多窗口合成图：主窗口打开第二个会话，第一个会话拆为独立窗口，
  // 再用 canvas 把两个窗口截图错位叠加（圆角 + 投影，透明背景）。
  await page.locator('.sidebar-session-row').filter({ hasText: 'Review the release c' })
    .locator('[data-testid^="sidebar-session-"]').first().click();
  await page.getByTestId('message-assistant').first().waitFor({ timeout: 30_000 });
  const mainWsClose = page.getByTestId('workspace-close');
  if (await mainWsClose.isVisible().catch(() => false)) await mainWsClose.click();
  const planRow = page.locator('.sidebar-session-row').filter({ hasText: 'Create a concise r' });
  const planTestId = await planRow.locator('[data-testid^="sidebar-session-"]').first().getAttribute('data-testid');
  const planSessionId = (planTestId ?? '').replace('sidebar-session-', '');
  const detachedPromise = app.waitForEvent('window');
  await planRow.click({ button: 'right' });
  await page.getByTestId(`sidebar-session-open-detached-${planSessionId}`).click();
  const detached = await detachedPromise;
  await detached.waitForLoadState('domcontentloaded');
  await detached.getByText('Release plan', { exact: true }).waitFor({ timeout: 30_000 });
  await detached.addStyleTag({ content: '.scroll-to-bottom { display: none !important; }' });
  const backShot = await page.screenshot();
  const frontShot = await detached.screenshot();
  const composed = await page.evaluate(async ({ back, front }) => {
    const load = (b64) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('screenshot decode failed'));
      img.src = `data:image/png;base64,${b64}`;
    });
    const [backImg, frontImg] = await Promise.all([load(back), load(front)]);
    const scale = 0.62;
    const fit = (img) => ({ w: Math.round(img.width * scale), h: Math.round(img.height * scale) });
    const backSize = fit(backImg);
    const frontSize = fit(frontImg);
    const offsetX = Math.round(frontSize.w * 0.32);
    const offsetY = Math.round(frontSize.h * 0.30);
    const pad = 48;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(backSize.w, frontSize.w + offsetX) + pad * 2;
    canvas.height = Math.max(backSize.h, frontSize.h + offsetY) + pad * 2;
    const ctx = canvas.getContext('2d');
    const drawWindow = (img, size, x, y) => {
      ctx.save();
      ctx.shadowColor = 'rgba(15, 23, 42, 0.35)';
      ctx.shadowBlur = 36;
      ctx.shadowOffsetY = 14;
      ctx.beginPath();
      ctx.roundRect(x, y, size.w, size.h, 10);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.clip();
      ctx.drawImage(img, x, y, size.w, size.h);
      ctx.restore();
    };
    drawWindow(backImg, backSize, pad, pad);
    drawWindow(frontImg, frontSize, pad + offsetX, pad + offsetY);
    return canvas.toDataURL('image/png');
  }, { back: backShot.toString('base64'), front: frontShot.toString('base64') });
  await writeFile(path.join(outputDir, 'windows.png'), Buffer.from(composed.slice('data:image/png;base64,'.length), 'base64'));
  await detached.close();

  // 分栏 shot：把第一个会话合成 drop 到面板右缘，同窗口左右两栏各跑一个会话
  const planPath = await planRow.locator('[data-testid^="sidebar-session-"]').first().getAttribute('title');
  await page.addStyleTag({ content: '.scroll-to-bottom { display: none !important; }' });
  await page.evaluate(({ sessionPath, cwd }) => {
    const target = document.querySelectorAll('.pane-leaf')[0];
    const rect = target.getBoundingClientRect();
    const dt = new DataTransfer();
    dt.setData('application/x-pi-session', JSON.stringify({ sessionPath, cwd }));
    target.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX: rect.right - 10,
      clientY: rect.top + rect.height / 2,
      dataTransfer: dt,
    }));
  }, { sessionPath: planPath, cwd: workspace });
  await page.locator('.pane-split-row').waitFor({ timeout: 30_000 });
  await page.locator('.pane-leaf').nth(1).getByText('Release plan', { exact: true }).waitFor({ timeout: 30_000 });
  await page.screenshot({ path: path.join(outputDir, 'panes.png') });
  await page.locator('.pane-leaf').nth(1).getByTestId('pane-close').first().click();
  await page.locator('.pane-leaf').nth(1).waitFor({ state: 'detached', timeout: 30_000 });

  await page.getByTestId('nav-extensions').click();
  await page.getByTestId('catalog-package-pi-mcp-adapter').waitFor({ timeout: 30_000 });
  await page.screenshot({ path: path.join(outputDir, 'packages.png') });

  await page.getByTestId('nav-chat').click();
  await page.getByTestId('new-chat').click();
  await page.getByTestId('chat-input').waitFor({ timeout: 30_000 });
  const composerWsClose = page.getByTestId('workspace-close');
  if (await composerWsClose.isVisible().catch(() => false)) await composerWsClose.click();
  await page.getByTestId('composer-plan-toggle').click();
  await page.getByTestId('composer-menu').click();
  await page.getByTestId('composer-file-reference').click();
  const notesFile = page.locator('[data-testid="file-option"]', { hasText: 'release-notes.md' });
  await notesFile.waitFor({ timeout: 30_000 });
  await notesFile.click();
  await page.getByTestId('staged-attachments').waitFor({ timeout: 30_000 });
  await page.getByTestId('composer-menu').click();
  await page.getByTestId('composer-file-reference').click();
  await page.getByTestId('file-dir').first().waitFor({ timeout: 30_000 });
  await page.getByTestId('file-dir').first().click();
  await page.locator('[data-testid="file-option"]', { hasText: 'design.md' }).waitFor({ timeout: 30_000 });
  await page.screenshot({ path: path.join(outputDir, 'composer.png') });

  await page.getByTestId('model-select').click();
  await page.getByTestId('model-menu').waitFor({ timeout: 30_000 });
  await page.getByTestId('model-menu-models').click();
  await page.getByTestId('model-group-toggle').first().waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="model-group-toggle"][data-value="local-studio"]').click();
  await page.locator('[data-testid="model-search"][data-value="local-studio"]').waitFor({ timeout: 30_000 });
  await page.screenshot({ path: path.join(outputDir, 'model-menu.png') });
} finally {
  await app?.close().catch(() => {});
  mock.kill();
  catalog.kill();
  await rm(fixtureRoot, { recursive: true, force: true });
}
