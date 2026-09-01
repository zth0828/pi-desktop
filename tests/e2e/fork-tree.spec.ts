// 消息级 fork + 会话内分支导航（/tree）E2E（真 pi + mock provider，不烧 API quota）。
// fork：从某条历史 user 消息分叉新会话，列表截断到该消息之前、文本回填输入框。
// tree：同会话文件内跳分支，列表面板选择节点后消息列表随之切换。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

/** 发一条消息并等 mock 回复完成（entryId 在 run 结束后才补齐） */
async function sendAndWaitReply(page: import('@playwright/test').Page, text: string) {
  await page.getByTestId('chat-input').fill(text);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
}

async function openTree(page: import('@playwright/test').Page) {
  await page.getByTestId('chat-input').fill('/tree');
  await page.getByTestId('chat-input').press('Enter');
  await expect(page.getByTestId('tree-dialog')).toBeVisible();
}

test('消息级 fork：从第二条 user 消息分叉，新会话只保留其之前的历史', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'first question');
  await sendAndWaitReply(page, 'second question');
  await expect(page.getByTestId('message-user')).toHaveCount(2);

  // hover 第二条 user 消息，点「从此分叉」
  const secondUser = page.getByTestId('message-user').filter({ hasText: 'second question' });
  const forkBtn = secondUser.getByTestId('fork-message');
  await expect(forkBtn).toBeAttached({ timeout: 30_000 });
  await secondUser.hover();
  await forkBtn.click();

  // sessionReplaced 刷新：只剩第一轮；被选消息文本回填输入框供编辑重发
  await expect(page.getByTestId('message-user')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId('message-user').first()).toContainText('first question');
  await expect(page.getByTestId('chat-input')).toHaveValue('second question');

  // 分叉后的新会话可继续对话
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
});

test('/tree 分支导航：跳到历史节点开新分支，再跳回原分支', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'first question');
  await sendAndWaitReply(page, 'second question');
  await expect(page.getByTestId('message-user')).toHaveCount(2);

  // 打开分支树：两轮对话 = 4 个消息节点
  await openTree(page);
  await expect(page.getByTestId('tree-node')).toHaveCount(4);

  // 点「first question」user 节点：leaf 移到其父（root），文本退回编辑器
  await page.getByTestId('tree-node').filter({ hasText: 'first question' }).click();
  // 跳分支前先问是否摘要被弃分支（branchSummarySkipPrompt=false 默认询问）
  await expect(page.getByTestId('tree-summary-choice')).toBeVisible();
  await page.getByTestId('tree-summary-no').click();
  await expect(page.getByTestId('tree-dialog')).toHaveCount(0);
  await expect(page.getByTestId('message-user')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('chat-input')).toHaveValue('first question');

  // 改发新消息 → 同一会话文件里长出第二条分支
  await sendAndWaitReply(page, 'branch question');
  await expect(page.getByTestId('message-user')).toHaveCount(1);

  // 树里同时看到两条分支的 user 节点
  await openTree(page);
  await expect(
    page.getByTestId('tree-node').filter({ hasText: 'second question' }),
  ).toHaveCount(1);
  await expect(
    page.getByTestId('tree-node').filter({ hasText: 'branch question' }),
  ).toHaveCount(1);

  // 跳回第一条分支：点「second question」user 节点 → 不摘要 → 列表回到第一轮，文本回填
  await page.getByTestId('tree-node').filter({ hasText: 'second question' }).click();
  await page.getByTestId('tree-summary-no').click();
  await expect(page.getByTestId('message-user')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId('message-user').first()).toContainText('first question');
  await expect(page.getByTestId('chat-input')).toHaveValue('second question');
});

test('/tree 跳分支选「摘要」：被弃分支写入 branch_summary 节点', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'first question');
  await sendAndWaitReply(page, 'second question');

  // 跳到第一条分支起点并改发新消息，长出第二条分支
  await openTree(page);
  await page.getByTestId('tree-node').filter({ hasText: 'first question' }).click();
  await page.getByTestId('tree-summary-no').click();
  await expect(page.getByTestId('chat-input')).toHaveValue('first question', { timeout: 30_000 });
  await sendAndWaitReply(page, 'branch question');

  // 跳回第一条分支，这次选「摘要」：被弃的 branch 分支应留下摘要节点
  await openTree(page);
  await page.getByTestId('tree-node').filter({ hasText: 'second question' }).click();
  await page.getByTestId('tree-summary-yes').click();
  // 摘要进行中显示等待态，完成后对话框关闭、列表切到目标分支
  await expect(page.getByTestId('tree-dialog')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('message-user').first()).toContainText('first question', {
    timeout: 30_000,
  });

  // 分支树里出现摘要节点（kind=other，内容是 mock 摘要文本）
  await openTree(page);
  await expect(page.locator('.tree-node[data-kind="other"]').first()).toBeVisible();
});

test('消息级编辑重发：点击编辑按钮，回填输入框，修改后重新发送', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'initial question');
  await sendAndWaitReply(page, 'editable question');
  await expect(page.getByTestId('message-user')).toHaveCount(2);

  // hover 第二条 user 消息，点「编辑并重发」
  const secondUser = page.getByTestId('message-user').filter({ hasText: 'editable question' });
  const editBtn = secondUser.getByTestId('edit-message');
  await expect(editBtn).toBeAttached({ timeout: 30_000 });
  await secondUser.hover();
  await editBtn.click();

  // sessionReplaced 刷新：只剩第一轮；输入框回填原文本
  await expect(page.getByTestId('message-user')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId('message-user').first()).toContainText('initial question');
  await expect(page.getByTestId('chat-input')).toHaveValue('editable question');

  // 修改文本后重新发送
  await page.getByTestId('chat-input').fill('edited question');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('message-user')).toHaveCount(2);
  await expect(page.getByTestId('message-user').last()).toContainText('edited question');
});
