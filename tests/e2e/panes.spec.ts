// 应用内多面板平铺 E2E：真 pi + mock provider，不烧 API quota。
// 1) 侧栏拖会话到面板右缘落区 → 分两列，两面板各自加载各自会话历史；
// 2) 两面板并发 SLOW_ECHO 慢速流式，回复各带标记、互不串台；
// 3) 拖会话到面板中心落区 → 替换该面板会话，邻面板不受影响；
// 4) 关闭面板 → 回单列，剩余面板内容完好可继续对话；
// 5) 侧栏「已打开」标记 + 点击已打开会话聚焦对应面板（data-active 焦点态）；
// 6) 拖出窗口（合成 dragstart/dragend + 窗口外坐标）→ 仍走 OS 级 openDetachedAt 开独立窗口。
// 7) 拖出途中按 Esc 取消（dragend 带窗口外取消点坐标）→ 不开窗：mac 上取消坐标是取消点
//    而非 (0,0)，坐标启发式接不住，靠 dragstart 后挂的 keydown 标记识别（session-drag.ts）。
// 8) 落区操作描述：合成 dragover 到右缘/中心 → overlay 中心显示分栏/替换描述并随指针切换，
//    dragleave 后消失（需求 1）。
// 9) 拖拽全局提示：dragstart → 顶部浮条出现，悬停落区时弱化（muted），dragend → 消失（需求 2）。
// HTML5 DnD 在 Playwright 无法原生拖拽，落区 drop 用合成 DragEvent（同 scripts/verify-panes-perf.mjs）。
// 模式同 multi-window.spec.ts：每用例独立 agentDir，mock 走 tests/fixtures/mock-openai-server.mjs。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
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

  workspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-workspace-'));
});

test.beforeEach(async () => {
  agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-agent-'));
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
  await writeFile(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({ defaultProvider: 'mock', defaultModel: 'mock-1' }),
  );
});

test.afterEach(async () => {
  // fixture 的 app 关闭发生在 afterEach 之后，pi 可能仍在往 agentDir 写会话文件，
  // 与 rm 竞争会偶发 ENOTEMPTY —— 用 fs.rm 内建重试兜住
  await rm(agentDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test.afterAll(async () => {
  mock?.kill();
  await rm(workspace, { recursive: true, force: true });
});

const launchOptions = () => ({
  withPi: true,
  agentDir,
  seedSettings: { workspaceCwd: workspace },
});

const pane = (page: Page, index: number) => page.locator('.pane-leaf').nth(index);

// evaluate 回调运行在页面 DOM 环境，但 e2e spec 走 tsconfig.node.json（无 DOM lib），
// 参考 chat.spec.ts 的做法对 globalThis 做结构化断言。
type DomRectLike = { left: number; right: number; top: number; width: number; height: number };
type DomElementLike = {
  getBoundingClientRect(): DomRectLike;
  dispatchEvent(event: unknown): boolean;
  closest(selector: string): DomElementLike | null;
};
type DomEnv = {
  document: {
    querySelector(selector: string): DomElementLike | null;
    querySelectorAll(selector: string): ArrayLike<DomElementLike>;
    dispatchEvent(event: unknown): boolean;
  };
  DataTransfer: new () => { setData(type: string, value: string): void };
  DragEvent: new (type: string, init: Record<string, unknown>) => unknown;
  KeyboardEvent: new (type: string, init: Record<string, unknown>) => unknown;
};

/** 等会话启动（模型选择器/徽标出现 = runtime 就绪） */
async function waitSessionReady(page: Page) {
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });
}

/** 发一条消息并等 mock 回复落地（保证会话文件已写入）；scope 缺省为整页（单面板） */
async function sendAndWaitReply(scope: Page | Locator, text: string) {
  await scope.getByTestId('chat-input').fill(text);
  await scope.getByTestId('chat-send').click();
  await expect(scope.getByTestId('message-assistant').last()).toContainText('PONG', {
    timeout: 30_000,
  });
}

/** 侧栏会话行 title 属性即会话文件路径（SessionList 里 title={session.path}） */
async function sessionPathOf(page: Page, sessionText: string): Promise<string> {
  const row = page.locator('.sidebar-session-row').filter({ hasText: sessionText });
  const sessionButton = row.locator('[data-testid^="sidebar-session-"]').first();
  await expect(sessionButton).toBeVisible({ timeout: 15_000 });
  const sessionPath = await sessionButton.getAttribute('title');
  expect(sessionPath).toBeTruthy();
  return sessionPath!;
}

/**
 * 合成 drop 把侧栏会话放进指定面板的落区（edge = 右缘分栏 / center = 中心替换）。
 * payload 必须带 cwd（同 SessionList dragstart）：缺 cwd 时 main 侧 switch 会退化为
 * 改绑全局 active runtime，抢走别的面板正在用的会话。
 */
async function dropSessionIntoPane(
  page: Page,
  sessionPath: string,
  paneIndex: number,
  zone: 'right' | 'center',
  cwd: string,
) {
  await page.evaluate(
    ({ sessionPath: p, paneIndex: i, zone: z, cwd: c }) => {
      const dom = globalThis as unknown as DomEnv;
      const target = dom.document.querySelectorAll('.pane-leaf')[i];
      const rect = target.getBoundingClientRect();
      const dt = new dom.DataTransfer();
      dt.setData('application/x-pi-session', JSON.stringify({ sessionPath: p, cwd: c }));
      target.dispatchEvent(new dom.DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: z === 'center' ? rect.left + rect.width / 2 : rect.right - 10,
        clientY: rect.top + rect.height / 2,
        dataTransfer: dt,
      }));
    },
    { sessionPath, paneIndex, zone, cwd },
  );
}

/** 造两个会话并拖成两面板：pane0 = 后建的 currentText 会话，pane1 = 拖入的 draggedText 会话 */
async function setupTwoPanes(page: Page, draggedText: string, currentText: string) {
  await sendAndWaitReply(page, `Say PONG ${draggedText}`);
  await page.getByTestId('new-chat').click();
  await sendAndWaitReply(page, `Say PONG ${currentText}`);
  const draggedPath = await sessionPathOf(page, draggedText);
  await dropSessionIntoPane(page, draggedPath, 0, 'right', workspace);
  await expect(page.locator('.pane-leaf')).toHaveCount(2, { timeout: 10_000 });
  // 等拖入面板 attach 完会话历史
  await expect(pane(page, 1).getByTestId('message-user').first()).toContainText(draggedText, {
    timeout: 30_000,
  });
}

test('拖入分栏：会话拖到面板右缘 → 分两列，两面板各自加载各自会话历史', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await setupTwoPanes(page, 'split ALPHA', 'stay BETA');

  // 两列布局：row 方向 split 容器 + 两个叶子面板
  await expect(page.locator('.pane-split-row')).toBeVisible();
  await expect(page.locator('.pane-leaf')).toHaveCount(2);

  // pane0 仍是当前会话 BETA，pane1 加载拖入会话 ALPHA 的历史
  await expect(pane(page, 0).getByTestId('message-user')).toHaveCount(1);
  await expect(pane(page, 0).getByTestId('message-user').last()).toContainText('stay BETA');
  await expect(pane(page, 0).getByTestId('message-assistant').last()).toContainText('PONG');
  await expect(pane(page, 1).getByTestId('message-user')).toHaveCount(1);
  await expect(pane(page, 1).getByTestId('message-user').last()).toContainText('split ALPHA');
  await expect(pane(page, 1).getByTestId('message-assistant').last()).toContainText('PONG');
});

test('两面板并发流式：各自收到自己的回复，互不串台', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await setupTwoPanes(page, 'stream ALPHA', 'stream BETA');

  // SLOW_ECHO 慢速回显：两路 SSE 同时在途，回复各自带 prompt 标记
  await pane(page, 0).getByTestId('chat-input').fill('SLOW_ECHO PANE-A MARKER');
  await pane(page, 0).getByTestId('chat-send').click();
  await pane(page, 1).getByTestId('chat-input').fill('SLOW_ECHO PANE-B MARKER');
  await pane(page, 1).getByTestId('chat-send').click();

  // 各自收到自己的流式回复
  await expect(
    pane(page, 0).getByTestId('message-assistant').filter({ hasText: 'PANE-A MARKER' }),
  ).toHaveCount(1, { timeout: 30_000 });
  await expect(
    pane(page, 1).getByTestId('message-assistant').filter({ hasText: 'PANE-B MARKER' }),
  ).toHaveCount(1, { timeout: 30_000 });

  // 互不串台：对端标记的 user/assistant 消息都不出现在本面板
  await expect(
    pane(page, 0).getByTestId('message-user').filter({ hasText: 'PANE-B' }),
  ).toHaveCount(0);
  await expect(
    pane(page, 0).getByTestId('message-assistant').filter({ hasText: 'PANE-B' }),
  ).toHaveCount(0);
  await expect(
    pane(page, 1).getByTestId('message-user').filter({ hasText: 'PANE-A' }),
  ).toHaveCount(0);
  await expect(
    pane(page, 1).getByTestId('message-assistant').filter({ hasText: 'PANE-A' }),
  ).toHaveCount(0);
  await expect(pane(page, 0).getByTestId('message-user')).toHaveCount(2);
  await expect(pane(page, 1).getByTestId('message-user')).toHaveCount(2);

  // 两轮都结束后，双方 composer 恢复可发状态
  await expect(pane(page, 0).getByTestId('chat-send')).toBeVisible({ timeout: 30_000 });
  await expect(pane(page, 1).getByTestId('chat-send')).toBeVisible({ timeout: 30_000 });
});

test('拖到中心替换会话：面板改绑新会话，邻面板不受影响', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // 造三个会话：ONE → TWO → THREE（pane0 当前 = THREE）
  await sendAndWaitReply(page, 'Say PONG replace ONE');
  await page.getByTestId('new-chat').click();
  await sendAndWaitReply(page, 'Say PONG replace TWO');
  await page.getByTestId('new-chat').click();
  await sendAndWaitReply(page, 'Say PONG keep THREE');

  // ONE 拖到 pane0 右缘 → pane1 = ONE
  await dropSessionIntoPane(page, await sessionPathOf(page, 'replace ONE'), 0, 'right', workspace);
  await expect(page.locator('.pane-leaf')).toHaveCount(2, { timeout: 10_000 });
  await expect(pane(page, 1).getByTestId('message-user').first()).toContainText('replace ONE', {
    timeout: 30_000,
  });

  // TWO 拖到 pane1 中心 → pane1 改绑 TWO
  await dropSessionIntoPane(page, await sessionPathOf(page, 'replace TWO'), 1, 'center', workspace);
  await expect(pane(page, 1).getByTestId('message-user').first()).toContainText('replace TWO', {
    timeout: 30_000,
  });
  await expect(pane(page, 1).getByTestId('message-user')).toHaveCount(1);
  await expect(pane(page, 1).getByTestId('message-user').filter({ hasText: 'ONE' })).toHaveCount(0);

  // pane0 不受影响：仍是 THREE 会话
  await expect(pane(page, 0).getByTestId('message-user')).toHaveCount(1);
  await expect(pane(page, 0).getByTestId('message-user').last()).toContainText('keep THREE');
});

test('关闭面板：回单列，剩余面板内容完好可继续对话', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await setupTwoPanes(page, 'close ALPHA', 'stay BETA');

  // 关掉 pane1 → 回单列
  await pane(page, 1).getByTestId('pane-close').click();
  await expect(page.locator('.pane-leaf')).toHaveCount(1, { timeout: 10_000 });

  // 剩余面板（BETA 会话）内容完好，可继续对话
  await expect(pane(page, 0).getByTestId('message-user')).toHaveCount(1);
  await expect(pane(page, 0).getByTestId('message-user').last()).toContainText('stay BETA');
  await sendAndWaitReply(pane(page, 0), 'Say PONG after close FOLLOWUP');
  await expect(pane(page, 0).getByTestId('message-user')).toHaveCount(2);
});

test('侧栏联动：已打开会话带标记，点击已打开会话聚焦对应面板', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await setupTwoPanes(page, 'focus ALPHA', 'focus BETA');
  // splitAt 会激活新拖入的面板：初始焦点在 pane1（ALPHA）
  await expect(page.locator('.pane-leaf[data-active]')).toContainText('focus ALPHA');

  // 两个已打开会话行都有「已打开」标记
  for (const text of ['focus ALPHA', 'focus BETA']) {
    const row = page.locator('.sidebar-session-row').filter({ hasText: text });
    await expect(row.locator('[data-testid^="sidebar-session-open-"]')).toBeVisible();
  }

  // 点击另一个已打开会话（BETA）→ 焦点切到 pane0
  const betaRow = page.locator('.sidebar-session-row').filter({ hasText: 'focus BETA' });
  await betaRow.locator('[data-testid^="sidebar-session-"]').first().click();
  await expect(page.locator('.pane-leaf[data-active]')).toContainText('focus BETA');

  // 再点 ALPHA → 焦点切回 pane1；布局不变（仍两个面板）
  const alphaRow = page.locator('.sidebar-session-row').filter({ hasText: 'focus ALPHA' });
  await alphaRow.locator('[data-testid^="sidebar-session-"]').first().click();
  await expect(page.locator('.pane-leaf[data-active]')).toContainText('focus ALPHA');
  await expect(page.locator('.pane-leaf')).toHaveCount(2);
});

test('拖出窗口仍开 OS 独立窗口（与分栏共存回归）', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'Say PONG dragout ALPHA');
  await page.getByTestId('new-chat').click();
  await sendAndWaitReply(page, 'Say PONG main BETA');

  // 合成 dragstart + dragend（窗口外坐标）：落区未消化 → SessionList dragend 上报
  // openDetachedAt；main 侧按窗口 bounds 判定落点在窗口外 → 创建独立窗口。
  // Playwright 无法真实把指针拖出 OS 窗口，这是该路径可自动化的最大粒度（落点判定
  // 之后与真实拖拽完全一致；窗口内松手由 bounds 判定兜住，单测已覆盖）。
  const alphaRow = page.locator('.sidebar-session-row').filter({ hasText: 'dragout ALPHA' });
  const sessionTestId = await alphaRow
    .locator('[data-testid^="sidebar-session-"]')
    .first()
    .getAttribute('data-testid');
  const sessionId = sessionTestId!.replace('sidebar-session-', '');
  await page.evaluate((id) => {
    const dom = globalThis as unknown as DomEnv;
    const button = dom.document.querySelector(`[data-testid="sidebar-session-${id}"]`);
    const row = button?.closest('.sidebar-session-row');
    if (!row) throw new Error('sidebar session row not found');
    const dt = new dom.DataTransfer();
    row.dispatchEvent(new dom.DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    row.dispatchEvent(new dom.DragEvent('dragend', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
      screenX: -3000,
      screenY: -3000,
    }));
  }, sessionId);

  await expect.poll(() => app.windows().length, { timeout: 15_000 }).toBe(2);
  const detached = app.windows().find((w) => w !== page)!;
  await waitSessionReady(detached);
  await expect(detached.getByTestId('message-user').last()).toContainText('dragout ALPHA', {
    timeout: 30_000,
  });
  // 主窗口仍停留在 BETA 会话，且未被拖出动作分栏
  await expect(page.getByTestId('message-user').last()).toContainText('main BETA');
  await expect(page.locator('.pane-leaf')).toHaveCount(1);
});

test('拖出途中按 Esc 取消 → 不开独立窗口', async ({ launchElectronApp }) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'Say PONG dragesc ALPHA');

  // 合成 dragstart → Escape keydown → dragend（窗口外取消点坐标，模拟 mac 上 Esc 取消
  // 时 dragend 坐标=取消点的真实行为）：Esc 标记命中 → 不上报 openDetachedAt。
  const alphaRow = page.locator('.sidebar-session-row').filter({ hasText: 'dragesc ALPHA' });
  const sessionTestId = await alphaRow
    .locator('[data-testid^="sidebar-session-"]')
    .first()
    .getAttribute('data-testid');
  const sessionId = sessionTestId!.replace('sidebar-session-', '');
  await page.evaluate((id) => {
    const dom = globalThis as unknown as DomEnv;
    const button = dom.document.querySelector(`[data-testid="sidebar-session-${id}"]`);
    const row = button?.closest('.sidebar-session-row');
    if (!row) throw new Error('sidebar session row not found');
    const dt = new dom.DataTransfer();
    row.dispatchEvent(new dom.DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    dom.document.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    row.dispatchEvent(new dom.DragEvent('dragend', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
      screenX: -3000,
      screenY: -3000,
    }));
  }, sessionId);

  // 给潜在的开窗一个出现窗口期，再断言窗口数不变
  await page.waitForTimeout(1_500);
  expect(app.windows()).toHaveLength(1);
  await expect(page.locator('.pane-leaf')).toHaveCount(1);
});

/** 合成 dragover/dragleave 到指定面板的指定位置（right 缘 / center），dataTransfer 带会话 MIME */
async function dragOverPaneLeaf(
  page: Page,
  action: 'dragover-right' | 'dragover-center' | 'dragleave',
) {
  await page.evaluate((act) => {
    const dom = globalThis as unknown as DomEnv;
    const target = dom.document.querySelectorAll('.pane-leaf')[0];
    const rect = target.getBoundingClientRect();
    const dt = new dom.DataTransfer();
    dt.setData('application/x-pi-session', JSON.stringify({ sessionPath: '/tmp/x', cwd: '/tmp' }));
    const type = act === 'dragleave' ? 'dragleave' : 'dragover';
    target.dispatchEvent(new dom.DragEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: act === 'dragover-center' ? rect.left + rect.width / 2 : rect.right - 10,
      clientY: rect.top + rect.height / 2,
      dataTransfer: dt,
    }));
  }, action);
}

test('落区操作描述：dragover 右缘显示分栏描述，移到中心切换为替换描述，dragleave 消失', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  // 右缘 → 分栏描述（zh「分栏」/ en「split」）
  await dragOverPaneLeaf(page, 'dragover-right');
  await expect(page.getByTestId('pane-drop-overlay')).toBeVisible();
  const label = page.getByTestId('pane-drop-label');
  await expect(label).toBeVisible();
  await expect(label).toHaveText(/分栏|split/i);
  await expect(page.getByTestId('pane-drop-highlight')).toHaveClass(/zone-right/);

  // 指针移到中心 → 实时切换为替换描述（zh「替换」/ en「replace」）
  await dragOverPaneLeaf(page, 'dragover-center');
  await expect(label).toHaveText(/替换|replace/i);
  await expect(page.getByTestId('pane-drop-highlight')).toHaveClass(/zone-center/);

  // dragleave → overlay 与描述一起消失
  await dragOverPaneLeaf(page, 'dragleave');
  await expect(page.getByTestId('pane-drop-overlay')).toHaveCount(0);
  await expect(page.getByTestId('pane-drop-label')).toHaveCount(0);
});

test('拖拽全局提示：dragstart 出现浮条，悬停落区弱化，dragend 消失', async ({
  launchElectronApp,
}) => {
  const app = await launchElectronApp(launchOptions());
  const page = await app.firstWindow();
  await waitSessionReady(page);

  await sendAndWaitReply(page, 'Say PONG draghint ALPHA');
  const alphaRow = page.locator('.sidebar-session-row').filter({ hasText: 'draghint ALPHA' });
  const sessionTestId = await alphaRow
    .locator('[data-testid^="sidebar-session-"]')
    .first()
    .getAttribute('data-testid');
  const sessionId = sessionTestId!.replace('sidebar-session-', '');

  // dragstart → 全局提示浮条出现
  await page.evaluate((id) => {
    const dom = globalThis as unknown as DomEnv;
    const button = dom.document.querySelector(`[data-testid="sidebar-session-${id}"]`);
    const row = button?.closest('.sidebar-session-row');
    if (!row) throw new Error('sidebar session row not found');
    const dt = new dom.DataTransfer();
    row.dispatchEvent(new dom.DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, sessionId);
  const hint = page.getByTestId('session-drag-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText(/分栏|split/i);
  await expect(hint).not.toHaveClass(/muted/);

  // 悬停落区 → 浮条弱化让位（落区中心描述接管）
  await dragOverPaneLeaf(page, 'dragover-right');
  await expect(page.getByTestId('pane-drop-label')).toBeVisible();
  await expect(hint).toHaveClass(/muted/);

  // dragleave → 落区描述消失（真实浏览器在 dragend 前会先触发 dragleave）
  await dragOverPaneLeaf(page, 'dragleave');
  await expect(page.getByTestId('pane-drop-overlay')).toHaveCount(0);

  // dragend（screenX/Y=0 → 视为取消，不开窗）→ 浮条消失
  await page.evaluate((id) => {
    const dom = globalThis as unknown as DomEnv;
    const button = dom.document.querySelector(`[data-testid="sidebar-session-${id}"]`);
    const row = button?.closest('.sidebar-session-row');
    if (!row) throw new Error('sidebar session row not found');
    const dt = new dom.DataTransfer();
    row.dispatchEvent(new dom.DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, sessionId);
  await expect(hint).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(app.windows()).toHaveLength(1);
});
