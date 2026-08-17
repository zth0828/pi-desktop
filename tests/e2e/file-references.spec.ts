// @ 文件引用 E2E：补全面板出现 → 选中插入 → 发送时 Main 侧展开（mock 断言收到文件内容）。
import { spawn, type ChildProcess, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';

let mock: ChildProcess;
let mockPort: number;
let agentDir: string;
let workspace: string;

test.beforeAll(async () => {
  mock = spawn(process.execPath, [
    path.join(process.cwd(), 'tests/fixtures/mock-openai-server.mjs'),
  ]);
  mockPort = await new Promise<number>((resolvePort, reject) => {
    mock.stdout?.on('data', (d) => {
      const m = String(d).match(/MOCK_PORT=(\d+)/);
      if (m) resolvePort(Number(m[1]));
    });
    setTimeout(() => reject(new Error('mock server timeout')), 10_000);
  });

  agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-agent-'));
  workspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-workspace-'));
  await writeFile(path.join(workspace, 'hello-e2e.txt'), 'UNIQUE_FILE_TOKEN_12345\n');
  await mkdir(path.join(workspace, 'sub'));
  await writeFile(path.join(workspace, 'sub', 'inner-e2e.md'), '# inner\n');
  // .gitignore 场景：fd 与 pi TUI 一样尊重忽略规则（需 git 仓库语义，同 TUI 的 fd 调用）
  await writeFile(path.join(workspace, 'ignored-e2e.txt'), 'IGNORED\n');
  await writeFile(path.join(workspace, '.gitignore'), 'ignored-e2e.txt\n');
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' });
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
});

test.afterAll(async () => {
  mock?.kill();
  await rm(agentDir, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

const launchOptions = () => ({
  withPi: true,
  agentDir,
  seedSettings: { workspaceCwd: workspace },
});

async function waitSessionReady(page: import('@playwright/test').Page) {
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });
}

test('@ 触发文件补全面板，选中后插入 @相对路径', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('@hello');
  const panel = page.getByTestId('file-panel');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByTestId('file-option').first()).toContainText('hello-e2e.txt');

  await panel.getByTestId('file-option').first().click();
  await expect(page.getByTestId('chat-input')).toHaveValue('@hello-e2e.txt ');
});

test('@ 补全尊重 .gitignore（fd 语义，与 pi TUI 一致）', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('@e2e');
  const panel = page.getByTestId('file-panel');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByTestId('file-option').filter({ hasText: 'hello-e2e.txt' })).toHaveCount(1);
  await expect(panel.getByTestId('file-option').filter({ hasText: 'ignored-e2e.txt' })).toHaveCount(0);
});

test('发送时 @path 展开为文件内容（mock 收到 <file> 块）', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('chat-input').fill('ECHO_USER @hello-e2e.txt');
  // 面板可能因尾部 @token 处于打开态，点发送按钮而不是 Enter（Enter 是选中候选）
  await page.getByTestId('chat-send').click();

  // 展开的文件独立显示为附件卡，正文不再被文件内容污染。
  const message = page.getByTestId('message-user').last();
  await expect(message.getByTestId('message-file')).toContainText('hello-e2e.txt');
  await expect(message.getByTestId('message-user-text')).toHaveText('ECHO_USER');
  await expect(message.getByTestId('message-user-text')).not.toContainText('UNIQUE_FILE_TOKEN_12345');
  // mock 回显最后一条 user 消息：证明展开后的文件内容确实发给了 provider
  await expect(page.getByTestId('message-assistant').last()).toContainText(
    'UNIQUE_FILE_TOKEN_12345',
    { timeout: 30_000 },
  );
});

test('附件按钮接受文本文件 → 暂存 chip → 随 prompt 以 <file> 块发出', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await page.getByTestId('attach-input').setInputFiles({
    name: 'attach-e2e.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('UNIQUE_ATTACH_TOKEN_67890'),
  });
  await expect(page.getByTestId('staged-file')).toContainText('attach-e2e.txt');

  await page.getByTestId('chat-input').fill('ECHO_USER with attachment');
  await page.getByTestId('chat-send').click();

  const message = page.getByTestId('message-user').last();
  await expect(message.getByTestId('message-file')).toContainText('attach-e2e.txt');
  await expect(message.getByTestId('message-user-text')).not.toContainText('UNIQUE_ATTACH_TOKEN_67890');
  await expect(page.getByTestId('message-assistant').last()).toContainText(
    'UNIQUE_ATTACH_TOKEN_67890',
    { timeout: 30_000 },
  );
});
