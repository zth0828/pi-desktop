import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from './fixtures/electron';
import { piTestEnv } from '../helpers/pi-prefix';

let agentDir: string;
let workspace: string;
let activeSessionId: string;
let archivedSessionId: string;

test.beforeAll(async () => {
  agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-search-agent-'));
  workspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-search-workspace-'));
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, 'models.json'), JSON.stringify({
    providers: {
      mock: {
        baseUrl: 'http://127.0.0.1:9/v1',
        api: 'openai-completions',
        apiKey: 'mock-key',
        models: [{
          id: 'mock-1',
          name: 'Mock 1',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 4096,
        }],
      },
    },
  }));
  await writeFile(path.join(agentDir, 'settings.json'), JSON.stringify({
    defaultProvider: 'mock',
    defaultModel: 'mock-1',
  }));

  const { piPackageRoot } = piTestEnv();
  const sdkEntry = path.join(piPackageRoot, 'dist/index.js');
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const sdk = (await import(pathToFileURL(sdkEntry).href)) as typeof import('@earendil-works/pi-coding-agent');

  const active = sdk.SessionManager.create(workspace);
  active.appendMessage({ role: 'user', content: 'Visible introduction', timestamp: Date.now() });
  for (let index = 1; index <= 8; index += 1) {
    active.appendMessage({ role: 'user', content: `Question ${index} with enough spacing for history`, timestamp: Date.now() + index * 2 });
    active.appendMessage({
      role: 'assistant',
      content: [{
        type: 'text',
        text: index === 8
          ? 'The hidden nebula phrase is in this final reply.'
          : `Ordinary reply ${index}. `.repeat(16),
      }],
      api: 'openai-completions',
      provider: 'mock',
      model: 'mock-1',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: Date.now() + index * 2 + 1,
    });
  }
  active.appendSessionInfo('Quarterly roadmap');
  activeSessionId = active.getSessionId();

  const archived = sdk.SessionManager.create(workspace);
  archived.appendMessage({
    role: 'user',
    content: [{ type: 'text', text: 'Archived telescope phrase' }],
    timestamp: Date.now() + 2,
  });
  archived.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'Archived reply' }],
    api: 'openai-completions',
    provider: 'mock',
    model: 'mock-1',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now() + 3,
  });
  archived.appendSessionInfo('Old launch notes');
  archived.appendCustomEntry('pi-desktop.archive', { archived: true });
  archivedSessionId = archived.getSessionId();
});

test.afterAll(async () => {
  await rm(agentDir, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

test('top controls stay stable and global search opens active or archived chats', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace },
    initialPage: 'settings',
  });
  const page = await app.firstWindow();
  await expect(page.getByTestId('nav-settings')).toHaveClass(/active/, { timeout: 30_000 });

  const controls = page.getByTestId('app-window-controls');
  await expect(controls).toBeVisible();
  await expect(controls).not.toContainText('Pi');
  await expect(page.getByTestId('session-search-trigger')).toBeVisible();
  const expandedBox = await controls.boundingBox();
  expect(expandedBox).not.toBeNull();

  await page.getByTestId('sidebar-toggle').click();
  await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'false');
  const collapsedBox = await controls.boundingBox();
  expect(collapsedBox).not.toBeNull();
  expect(collapsedBox!.x).toBe(expandedBox!.x);
  expect(collapsedBox!.y).toBe(expandedBox!.y);

  await page.getByTestId('session-search-trigger').click();
  const input = page.getByTestId('session-search-input');
  await expect(input).toBeFocused();
  await input.fill('hidden nebula');
  const contentResult = page.getByTestId(`session-search-result-${activeSessionId}`);
  await expect(contentResult).toBeVisible({ timeout: 15_000 });
  await expect(contentResult).toContainText('The hidden nebula phrase');
  await expect(contentResult).toContainText('Message');
  await page.screenshot({ path: 'output/playwright/session-search-open.png', fullPage: false });

  await contentResult.click();
  await expect(page.getByTestId('session-search-dialog')).toHaveCount(0);
  const matchedAssistant = page.locator('#chat-msg-16');
  await expect(matchedAssistant).toBeInViewport({ timeout: 15_000 });
  await expect(matchedAssistant).toHaveClass(/search-target/);
  await expect.poll(() => page.getByTestId('message-list').evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
  await page.screenshot({ path: 'output/playwright/session-search-target.png', fullPage: false });

  await page.getByTestId('session-search-trigger').click();
  await page.getByTestId('session-search-input').fill('telescope phrase');
  const archivedResult = page.getByTestId(`session-search-result-${archivedSessionId}`);
  await expect(archivedResult).toBeVisible({ timeout: 15_000 });
  await expect(archivedResult).toContainText('Archived');
  await archivedResult.click();

  await expect(page.getByTestId('session-search-dialog')).toHaveCount(0);
  await expect(page.getByTestId('session-title-button')).toContainText('Old launch notes', { timeout: 15_000 });
  await expect(page.getByTestId('message-user-text').first()).toContainText('Archived telescope phrase');
  await page.screenshot({ path: 'output/playwright/session-search-selected.png', fullPage: false });
  await app.close();
});
