// 项目信任 E2E：含 .pi 门控资源的工作区启动会话时弹出信任确认（pi resolveProjectTrusted 通道）。
// 覆盖：信任 → 项目 prompt 模板加载 + trust.json 落盘；不信任 → 资源不加载 + 落盘 false。
import { spawn, type ChildProcess } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';

let mock: ChildProcess;
let mockPort: number;

test.beforeAll(async () => {
  mock = spawn(process.execPath, [
    path.join(process.cwd(), 'tests/fixtures/mock-openai-server.mjs'),
  ]);
  mockPort = await new Promise((resolvePort, reject) => {
    mock.stdout?.on('data', (d) => {
      const m = String(d).match(/MOCK_PORT=(\d+)/);
      if (m) resolvePort(Number(m[1]));
    });
    setTimeout(() => reject(new Error('mock timeout')), 10_000);
  });
});

test.afterAll(async () => {
  mock?.kill();
});

async function makeEnv() {
  const agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-agent-'));
  const workspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-workspace-'));
  await writeFile(
    path.join(agentDir, 'models.json'),
    JSON.stringify({
      providers: {
        mock: {
          baseUrl: `http://127.0.0.1:${mockPort}/v1`,
          api: 'openai-completions',
          apiKey: 'mock-key',
          models: [
            {
              id: 'mock-1',
              name: 'Mock 1',
              reasoning: false,
              input: ['text'],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 4096,
            },
          ],
        },
      },
    }),
  );
  // 门控资源：项目级 prompt 模板（trust-requiring）
  await mkdir(path.join(workspace, '.pi/prompts'), { recursive: true });
  await writeFile(
    path.join(workspace, '.pi/prompts/trust-probe.md'),
    '---\ndescription: Trust probe prompt\n---\nTrust probe body.',
  );
  return { agentDir, workspace };
}

async function readTrust(agentDir: string): Promise<Record<string, boolean>> {
  return JSON.parse(await readFile(path.join(agentDir, 'trust.json'), 'utf8')) as Record<string, boolean>;
}

test('信任项目 → 项目资源加载且信任落盘', async ({ launchElectronApp }) => {
  const { agentDir, workspace } = await makeEnv();
  try {
    const app = await launchElectronApp({
      withPi: true,
      agentDir,
      seedSettings: { workspaceCwd: workspace },
    });
    const page = await app.firstWindow();

    const dialog = page.getByTestId('trust-dialog');
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByTestId('trust-cwd')).toHaveText(workspace);
    // pi 选项集：Trust / Trust parent / Trust session-only / Do not trust / Do not trust session-only
    await expect(dialog.getByTestId('trust-option')).toHaveCount(5);

    await dialog.getByTestId('trust-option').first().click();
    await expect(dialog).toBeHidden();
    // 信任后会话完成启动
    await expect(
      page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
    ).toBeVisible({ timeout: 30_000 });
    // 项目 prompt 模板进 / 补全
    await page.getByTestId('chat-input').fill('/');
    await expect(page.getByTestId('command-trust-probe')).toBeVisible({ timeout: 15_000 });
    // 落盘 trust.json（key 为 realpath 规范化路径）
    await expect(async () => {
      expect((await readTrust(agentDir))[realpathSync(workspace)]).toBe(true);
    }).toPass({ timeout: 10_000 });
  } finally {
    await rm(agentDir, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test('不信任项目 → 门控资源不加载且落盘 false', async ({ launchElectronApp }) => {
  const { agentDir, workspace } = await makeEnv();
  try {
    const app = await launchElectronApp({
      withPi: true,
      agentDir,
      seedSettings: { workspaceCwd: workspace },
    });
    const page = await app.firstWindow();

    const dialog = page.getByTestId('trust-dialog');
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    // 第 4 项 = Do not trust
    await dialog.getByTestId('trust-option').nth(3).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('chat-input').fill('/');
    await expect(page.getByTestId('command-panel')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('command-trust-probe')).toHaveCount(0);
    await expect(async () => {
      expect((await readTrust(agentDir))[realpathSync(workspace)]).toBe(false);
    }).toPass({ timeout: 10_000 });
  } finally {
    await rm(agentDir, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});
