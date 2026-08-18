import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { piTestEnv } from '../helpers/pi-prefix';

const packagedApp = process.env.PI_DESKTOP_PACKAGED_APP;
const shouldRun = process.platform === 'darwin' && Boolean(packagedApp);

test.skip(!shouldRun, 'Set PI_DESKTOP_PACKAGED_APP to run the packaged macOS smoke test.');

test('packaged app.asar starts and sends through pi with the local mock provider', async () => {
  const pi = piTestEnv();
  const home = await mkdtemp(path.join(tmpdir(), 'pi-desktop-packaged-home-'));
  const userData = path.join(home, 'user-data');
  const agentDir = path.join(home, 'pi-agent');
  const workspace = path.join(home, 'workspace');
  await mkdir(userData, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await mkdir(workspace, { recursive: true });

  let mock: ChildProcess | undefined;
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    mock = spawn(process.execPath, [path.join(process.cwd(), 'tests/fixtures/mock-openai-server.mjs')]);
    const port = await new Promise<number>((resolvePort, reject) => {
      mock?.stdout?.on('data', (data) => {
        const match = String(data).match(/MOCK_PORT=(\d+)/);
        if (match) resolvePort(Number(match[1]));
      });
      setTimeout(() => reject(new Error('mock server timeout')), 10_000);
    });
    await writeFile(path.join(agentDir, 'models.json'), JSON.stringify({
      providers: {
        mock: {
          baseUrl: `http://127.0.0.1:${port}/v1`,
          api: 'openai-completions',
          apiKey: 'mock-key',
          models: [{
            id: 'mock-1', name: 'Mock 1', reasoning: false, input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000, maxTokens: 4096,
          }],
        },
      },
    }));
    await writeFile(path.join(userData, 'config.json'), JSON.stringify({ workspaceCwd: workspace }));

    app = await electron.launch({
      executablePath: packagedApp!,
      args: ['--lang=en-US', '--no-sandbox'],
      env: {
        ...process.env,
        HOME: home,
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        PI_CODING_AGENT_DIR: agentDir,
        PI_DESKTOP_USER_DATA_DIR: userData,
        PI_DESKTOP_USER_PATH: `${pi.piBinDir}${path.delimiter}${path.dirname(process.execPath)}:/usr/bin:/bin`,
        PI_DESKTOP_NPM_ROOT: pi.npmRoot,
      },
      timeout: 60_000,
    });
    const page = await app.firstWindow();
    await expect(page.getByTestId('model-select').or(page.getByTestId('model-badge')).first())
      .toBeVisible({ timeout: 30_000 });
    await page.getByTestId('chat-input').fill('Say PONG');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', { timeout: 30_000 });
  } finally {
    mock?.kill();
    await app?.close().catch(() => undefined);
    await rm(home, { recursive: true, force: true });
  }
});
