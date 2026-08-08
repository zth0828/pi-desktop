// 扩展 UI 桥 E2E：agentDir/extensions 里的测试扩展注册 /e2e-ui 命令，
// 依次调 ctx.ui.confirm/select/input；断言壳弹出对话框、用户操作经
// piRuntime.uiResponse 回传后扩展流程继续（结果写进 workspace 文件供断言）。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';

let mock: ChildProcess;
let mockPort: number;
let agentDir: string;
let workspace: string;
let resultFile: string;

const EXTENSION_SOURCE = `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default function (pi: any) {
  pi.registerCommand('e2e-ui', {
    description: 'E2E extension UI bridge test',
    handler: async (_args: string, ctx: any) => {
      const ok = await ctx.ui.confirm('E2E Confirm Title', 'Proceed with E2E?');
      const choice = await ctx.ui.select('E2E Select Title', ['Red', 'Green', 'Blue']);
      const text = await ctx.ui.input('E2E Input Title', 'type something');
      writeFileSync(
        join(ctx.cwd, 'e2e-ui-result.json'),
        JSON.stringify({ ok, choice: choice ?? null, text: text ?? null }),
      );
    },
  });
}
`;

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
  resultFile = path.join(workspace, 'e2e-ui-result.json');
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
  // 测试扩展：pi 自动加载 agentDir/extensions/<name>/index.ts
  const extDir = path.join(agentDir, 'extensions', 'e2e-ui');
  await mkdir(extDir, { recursive: true });
  await writeFile(path.join(extDir, 'index.ts'), EXTENSION_SOURCE);
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

async function triggerCommand(page: import('@playwright/test').Page) {
  await page.getByTestId('chat-input').fill('/e2e-ui');
  await page.getByTestId('chat-send').click();
}

/** 扩展 handler 走完三个对话框后落盘的结果 */
async function readResult(): Promise<{ ok: boolean; choice: string | null; text: string | null }> {
  return JSON.parse(await readFile(resultFile, 'utf-8'));
}

test('confirm/select/input 全流程：对话框出现，用户操作回传扩展', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);
  await rm(resultFile, { force: true });

  await triggerCommand(page);

  // 1) confirm：标题 + 正文 + 确认
  const dialog = page.getByTestId('extui-dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toHaveAttribute('data-kind', 'confirm');
  await expect(dialog).toContainText('E2E Confirm Title');
  await expect(page.getByTestId('extui-message')).toHaveText('Proceed with E2E?');
  await page.getByTestId('extui-confirm').click();

  // 2) select：选项列表，选 Green
  await expect(dialog).toHaveAttribute('data-kind', 'select');
  await expect(dialog).toContainText('E2E Select Title');
  await expect(page.getByTestId('extui-option')).toHaveCount(3);
  await page.getByTestId('extui-option').filter({ hasText: 'Green' }).click();

  // 3) input：占位符 + 文本提交
  await expect(dialog).toHaveAttribute('data-kind', 'input');
  await expect(page.getByTestId('extui-input')).toHaveAttribute('placeholder', 'type something');
  await page.getByTestId('extui-input').fill('hello from shell');
  await page.getByTestId('extui-submit').click();

  // 队列清空，对话框消失；扩展拿到三个结果并落盘
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => readResult().catch(() => null), { timeout: 30_000 })
    .toEqual({ ok: true, choice: 'Green', text: 'hello from shell' });
});

test('取消路径：confirm 取消 → false，select/input 取消 → undefined', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);
  await rm(resultFile, { force: true });

  await triggerCommand(page);

  const dialog = page.getByTestId('extui-dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('extui-cancel').click();

  await expect(dialog).toHaveAttribute('data-kind', 'select');
  await page.getByTestId('extui-cancel').click();

  await expect(dialog).toHaveAttribute('data-kind', 'input');
  await page.getByTestId('extui-cancel').click();

  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => readResult().catch(() => null), { timeout: 30_000 })
    .toEqual({ ok: false, choice: null, text: null });
});
