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

  await page.getByTestId('nav-extensions').click();
  await page.getByTestId('catalog-package-pi-mcp-adapter').waitFor({ timeout: 30_000 });
  await page.screenshot({ path: path.join(outputDir, 'packages.png') });
} finally {
  await app?.close().catch(() => {});
  mock.kill();
  catalog.kill();
  await rm(fixtureRoot, { recursive: true, force: true });
}
