// 用户消息导航 rail E2E（真 pi + mock provider，不烧 API quota）。
// 每条 user 消息一个圆点；点击平滑滚动到对应消息；当前可视位置附近的点高亮。
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

test('rail 圆点 = user 消息数；悬浮显示原问题，点击跳转并高亮', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1200, height: 720 });
  const trustDialog = page.getByTestId('trust-dialog');
  const modelReady = page.getByTestId('model-select').or(page.getByTestId('model-badge')).first();
  await expect(trustDialog.or(modelReady).first()).toBeVisible({ timeout: 30_000 });
  if (await trustDialog.isVisible()) {
    await trustDialog.getByTestId('trust-option').first().click();
    await expect(trustDialog).toBeHidden();
  }
  await expect(modelReady).toBeVisible({ timeout: 30_000 });

  // 8 轮对话，保证消息列表溢出可滚动（第 2 轮使用超长问题验证 tooltip 截断）
  const rounds = 8;
  const longQuestion = `Say PONG 2 ${'long '.repeat(60)}`;
  for (let i = 1; i <= rounds; i++) {
    const question = i === 2 ? longQuestion : `Say PONG ${i}`;
    await page.getByTestId('chat-input').fill(question);
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('message-user')).toHaveCount(i, { timeout: 30_000 });
    await expect(page.getByTestId('message-assistant')).toHaveCount(i, { timeout: 30_000 });
  }

  const rail = page.getByTestId('msg-rail');
  await expect(rail).toBeVisible();
  await expect(rail.locator('.msg-rail-dot')).toHaveCount(rounds);

  // 长问题 tooltip 截断在 120 字符并追加省略号
  const secondDot = page.getByTestId('msg-rail-dot-chat-msg-2');
  await secondDot.hover();
  await expect(secondDot.getByTestId('msg-rail-tooltip')).toBeVisible();
  const secondTooltip = await secondDot.getByTestId('msg-rail-tooltip').textContent();
  expect(Array.from(secondTooltip ?? '')).toHaveLength(121);
  expect(secondTooltip?.endsWith('…')).toBe(true);

  const thirdDot = page.getByTestId('msg-rail-dot-chat-msg-4');
  await thirdDot.hover();
  await expect(thirdDot.getByTestId('msg-rail-tooltip')).toBeVisible();
  await expect(thirdDot.getByTestId('msg-rail-tooltip')).toHaveText('Say PONG 3');

  // 新消息自动滚到底 → 列表已溢出、末位圆点高亮
  const list = page.getByTestId('message-list');
  await expect.poll(() => list.evaluate((el) => el.scrollTop), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId(`msg-rail-dot-chat-msg-${(rounds - 1) * 2}`)).toHaveClass(/active/);

  // 点击首点后只滚动消息列表，不带动外层 content；目标消息、标题栏和 composer 都保持可见。
  await expect(thirdDot).toHaveAttribute('title', 'Say PONG 3');
  await expect(thirdDot).toHaveAttribute('aria-label', /Say PONG 3/);
  await page.getByTestId('msg-rail-dot-chat-msg-0').click();
  await expect.poll(() => list.evaluate((el) => el.scrollTop), { timeout: 10_000 }).toBeLessThan(60);
  await expect(page.locator('#chat-msg-0')).toBeInViewport();
  await expect.poll(() => page.locator('.content').evaluate((el) => el.scrollTop)).toBe(0);
  await expect(page.getByTestId('session-titlebar')).toBeInViewport();
  await expect(page.getByTestId('chat-input')).toBeInViewport();
  const activeId = await rail.locator('.msg-rail-dot.active').getAttribute('data-testid');
  expect([
    'msg-rail-dot-chat-msg-0',
    'msg-rail-dot-chat-msg-2',
    'msg-rail-dot-chat-msg-4',
  ]).toContain(activeId);
  await expect(rail.locator('.msg-rail-dot.active')).toHaveCount(1);

  // 手动上滑后显示回到底部入口；点击后恢复自动跟随底部。
  await list.evaluate((el) => { el.scrollTop = 0; });
  await expect(page.getByTestId('scroll-to-bottom')).toBeVisible();
  await page.getByTestId('scroll-to-bottom').click();
  await expect(page.getByTestId('scroll-to-bottom')).toBeHidden();
  await expect.poll(() => list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(24);
});


test('rail folds after ten messages and exposes a dismissible message group panel', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace },
  });
  const page = await app.firstWindow();
  const trustDialog = page.getByTestId('trust-dialog');
  const modelReady = page.getByTestId('model-select').or(page.getByTestId('model-badge')).first();
  await expect(trustDialog.or(modelReady).first()).toBeVisible({ timeout: 30_000 });
  if (await trustDialog.isVisible()) {
    await trustDialog.getByTestId('trust-option').first().click();
    await expect(trustDialog).toBeHidden();
  }
  await expect(modelReady).toBeVisible({ timeout: 30_000 });

  const longQuestion = `Say PONG 5  \n${'long \t '.repeat(60)} full question tail`;
  for (let i = 1; i <= 10; i++) {
    const question = i === 5 ? longQuestion : `Say PONG ${i}`;
    await page.getByTestId('chat-input').fill(question);
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('message-user')).toHaveCount(i, { timeout: 30_000 });
    await expect(page.getByTestId('message-assistant')).toHaveCount(i, { timeout: 30_000 });
  }

  await expect(page.getByTestId('msg-rail')).toBeVisible();
  await expect(page.getByTestId('msg-rail-group')).toHaveCount(0);
  await expect(page.getByTestId('msg-rail').locator('.msg-rail-dot')).toHaveCount(10);

  await page.getByTestId('chat-input').fill('Say PONG 11');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-user')).toHaveCount(11, { timeout: 30_000 });
  await expect(page.getByTestId('message-assistant')).toHaveCount(11, { timeout: 30_000 });
  // 消息计数完成不代表 rail 的下一帧 active 测量已提交；先等到底部 active，
  // 再验证末端保护区对应的单个折叠组，避免把中途 active 当成产品状态。
  await expect(page.getByTestId('msg-rail-dot-chat-msg-20')).toHaveClass(/active/);

  const groupButton = page.getByTestId('msg-rail-group').first();
  await expect(groupButton).toBeVisible();
  await expect(groupButton).toHaveAttribute('type', 'button');
  await expect(groupButton).toHaveAttribute('aria-expanded', 'false');
  await groupButton.click();

  const panel = page.getByTestId('msg-rail-group-panel');
  await expect(panel).toBeVisible();
  await expect(groupButton).toHaveAttribute('aria-expanded', 'true');
  const rows = panel.locator('[data-testid^="msg-rail-group-row-"]');
  await expect(rows).toHaveCount(7);
  expect((await rows.allTextContents()).join('')).not.toContain('第');
  await expect(panel).toContainText('Say PONG 3');
  await expect(panel).toContainText('Say PONG 9');

  const longRow = panel.getByTestId('msg-rail-group-row-chat-msg-8');
  await expect(longRow).toHaveCSS('text-overflow', 'ellipsis');
  await expect(longRow).toHaveCSS('white-space', 'nowrap');
  const normalizedQuestion = longQuestion.replace(/\s+/g, ' ').trim();
  await expect(longRow).toHaveAttribute('title', normalizedQuestion);
  await expect(longRow).toHaveText(normalizedQuestion);
  const longRowText = longRow.locator('.msg-rail-group-row-text');
  await expect(longRowText).toHaveCSS('text-overflow', 'ellipsis');
  await expect(longRowText).toHaveCSS('white-space', 'nowrap');
  expect(await longRowText.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

  // panel 内 hover 必须取消 180ms 的延迟收起定时器。
  await panel.hover();
  await page.waitForTimeout(250);
  await expect(panel).toBeVisible();

  // 外部点击和 Escape 都能关闭 panel。
  await page.mouse.click(0, 0);
  await expect(panel).toBeHidden({ timeout: 1_000 });

  await groupButton.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  // 组内点击先关闭 panel，再执行真实消息定位。
  await groupButton.click();
  await expect(panel).toBeVisible();
  const targetRow = panel.getByTestId('msg-rail-group-row-chat-msg-4');
  await expect(targetRow).toHaveAttribute('title', await targetRow.textContent() ?? '');
  await expect(targetRow).toHaveAttribute('aria-label', /Say PONG 3/);
  await targetRow.click();
  await expect(panel).toBeHidden();
  await expect(page.locator('#chat-msg-4')).toBeInViewport();
});


test('return to bottom cancels in-flight ordinary and group jumps and restores rail state', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace },
  });
  const page = await app.firstWindow();
  const trustDialog = page.getByTestId('trust-dialog');
  const modelReady = page.getByTestId('model-select').or(page.getByTestId('model-badge')).first();
  await expect(trustDialog.or(modelReady).first()).toBeVisible({ timeout: 30_000 });
  if (await trustDialog.isVisible()) {
    await trustDialog.getByTestId('trust-option').first().click();
    await expect(trustDialog).toBeHidden();
  }
  await expect(modelReady).toBeVisible({ timeout: 30_000 });
  for (let i = 1; i <= 11; i++) {
    await page.getByTestId('chat-input').fill(`Say PONG ${i}`);
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('message-user')).toHaveCount(i, { timeout: 30_000 });
    await expect(page.getByTestId('message-assistant')).toHaveCount(i, { timeout: 30_000 });
  }

  const list = page.getByTestId('message-list');
  const panel = page.getByTestId('msg-rail-group-panel');
  const arrow = page.getByTestId('scroll-to-bottom');
  const bottomGap = () => list.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);

  // 普通点和组内点都必须真实移动列表，而不仅仅改变 active。
  await page.getByTestId('msg-rail-dot-chat-msg-0').click();
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeLessThan(24);
  await expect(page.locator('#chat-msg-0')).toBeInViewport();
  await page.getByTestId('msg-rail-group').first().click();
  await panel.getByTestId('msg-rail-group-row-chat-msg-8').click();
  await expect(panel).toBeHidden();
  await expect(page.locator('#chat-msg-8')).toBeInViewport();
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);

  for (const phase of ['before-frame', 'after-movement'] as const) {
    for (const kind of ['ordinary', 'group'] as const) {
      await test.step(phase + ': ' + kind, async () => {
        await page.getByTestId('msg-rail-dot-chat-msg-0').click();
        await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeLessThan(24);
        await expect(arrow).toBeVisible();
        await page.getByTestId('msg-rail-group').first().click();
        await expect(panel).toBeVisible();
        const jumpId = kind === 'group' ? 'msg-rail-group-row-chat-msg-8' : 'msg-rail-dot-chat-msg-2';
        const observed = await page.evaluate(({ jumpId, phase, kind }) => new Promise<{
          movement: number; remaining: number; immediateGap: number; largestGap: number;
        }>((resolve, reject) => {
          const el = document.querySelector<HTMLElement>('[data-testid="message-list"]')!;
          const target = document.getElementById(kind === 'group' ? 'chat-msg-8' : 'chat-msg-2')!;
          const startTop = el.scrollTop;
          const endTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight,
            startTop + target.getBoundingClientRect().top - el.getBoundingClientRect().top - 8));
          const startedAt = performance.now();
          let cancelledAt: number | undefined;
          let movement = 0;
          let remaining = 0;
          let immediateGap = 0;
          let largestGap = 0;
          const gap = () => el.scrollHeight - el.clientHeight - el.scrollTop;
          const cancel = () => {
            movement = Math.abs(el.scrollTop - startTop);
            remaining = Math.abs(endTop - el.scrollTop);
            document.querySelector<HTMLButtonElement>('[data-testid="scroll-to-bottom"]')!.click();
            cancelledAt = performance.now();
            immediateGap = largestGap = gap();
          };
          const sample = () => {
            const now = performance.now();
            if (cancelledAt === undefined && Math.abs(el.scrollTop - startTop) >= 2) cancel();
            if (cancelledAt !== undefined) {
              largestGap = Math.max(largestGap, gap());
              if (now - cancelledAt >= 700) {
                resolve({ movement, remaining, immediateGap, largestGap });
                return;
              }
            } else if (now - startedAt > 2_000) {
              reject(new Error('Jump never produced a frame with real movement'));
              return;
            }
            requestAnimationFrame(sample);
          };
          // 先安装观察器；位移出现后在浏览器内接管，不受 CDP/actionability 往返延迟影响。
          requestAnimationFrame(sample);
          document.querySelector<HTMLButtonElement>('[data-testid="' + jumpId + '"]')!.click();
          if (phase === 'before-frame') cancel();
        }), { jumpId, phase, kind });
        if (phase === 'after-movement') {
          expect(observed.movement).toBeGreaterThanOrEqual(2);
          expect(observed.remaining).toBeGreaterThan(24);
        } else {
          expect(observed.movement).toBe(0);
        }
        expect(observed.immediateGap).toBeLessThanOrEqual(2);
        expect(observed.largestGap).toBeLessThanOrEqual(2);
        expect(await bottomGap()).toBeLessThanOrEqual(2);
        await expect(arrow).toBeHidden();
        await expect(page.getByTestId('msg-rail-dot-chat-msg-20')).toHaveClass(/active/);
        await expect(panel).toBeHidden();
        await expect(page.getByTestId('message-assistant').last()).toBeInViewport();
        await expect.poll(() => page.locator('.content').evaluate((el) => el.scrollTop)).toBe(0);
      });
    }
  }

  // 回底后新消息仍自动跟随，而不是留在上一次主动跳转的位置。
  await page.getByTestId('chat-input').fill('Say PONG 12');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('message-assistant')).toHaveCount(12, { timeout: 30_000 });
  await expect.poll(bottomGap).toBeLessThanOrEqual(2);
  await expect(page.getByTestId('message-assistant').last()).toBeInViewport();
  await expect(arrow).toBeHidden();
});


test('same-session search takes over a jump after real animation movement without stale frames', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace },
  });
  const page = await app.firstWindow();
  const trustDialog = page.getByTestId('trust-dialog');
  const modelReady = page.getByTestId('model-select').or(page.getByTestId('model-badge')).first();
  await expect(trustDialog.or(modelReady).first()).toBeVisible({ timeout: 30_000 });
  if (await trustDialog.isVisible()) {
    await trustDialog.getByTestId('trust-option').first().click();
    await expect(trustDialog).toBeHidden();
  }
  await expect(modelReady).toBeVisible({ timeout: 30_000 });
  // agentDir 在同一 worker 的用例间共享；唯一短语避免误选其他测试留下的会话。
  const searchPhrase = 'Say PONG 11 search takeover ' + Date.now();
  for (let i = 1; i <= 11; i++) {
    await page.getByTestId('chat-input').fill(i === 11 ? searchPhrase : 'Say PONG ' + i);
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('message-user')).toHaveCount(i, { timeout: 30_000 });
    await expect(page.getByTestId('message-assistant')).toHaveCount(i, { timeout: 30_000 });
  }
  const list = page.getByTestId('message-list');
  await expect.poll(() => list.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(2);
  await page.getByTestId('session-search-trigger').click();
  await page.getByTestId('session-search-input').fill(searchPhrase);
  const result = page.locator('[data-testid^="session-search-result-"]').filter({ hasText: searchPhrase });
  await expect(result).toHaveCount(1);
  await expect(result).toBeVisible();

  const resultId = await result.getAttribute('data-testid');
  const observed = await page.evaluate((resultId) => new Promise<{
    movement: number; remaining: number; highlightedFrames: number; outsideFrames: number;
  }>((resolve, reject) => {
    const el = document.querySelector<HTMLElement>('[data-testid="message-list"]')!;
    const target = document.getElementById('chat-msg-20')!;
    const result = document.querySelector<HTMLButtonElement>('[data-testid="' + resultId + '"]')!;
    const startTop = el.scrollTop;
    const startedAt = performance.now();
    let selectedAt: number | undefined;
    let movement = 0;
    let remaining = 0;
    let highlightedFrames = 0;
    let outsideFrames = 0;
    const sample = () => {
      const now = performance.now();
      if (selectedAt === undefined && startTop - el.scrollTop >= 2) {
        movement = startTop - el.scrollTop;
        remaining = el.scrollTop;
        selectedAt = now;
        result.click();
      }
      if (target.classList.contains('search-target')) {
        highlightedFrames++;
        const listRect = el.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        if (targetRect.bottom <= listRect.top || targetRect.top >= listRect.bottom) outsideFrames++;
      }
      if (selectedAt !== undefined && now - selectedAt >= 700) {
        resolve({ movement, remaining, highlightedFrames, outsideFrames });
        return;
      }
      if (selectedAt === undefined && now - startedAt > 2_000) {
        reject(new Error('Jump never produced a frame with real movement'));
        return;
      }
      requestAnimationFrame(sample);
    };
    // 真实 RAF 位移后才选搜索结果；从跳转前连续采样，捕获先拉走再被 interval 拉回的瞬态。
    requestAnimationFrame(sample);
    document.querySelector<HTMLButtonElement>('[data-testid="msg-rail-dot-chat-msg-0"]')!.click();
  }), resultId);
  expect(observed.movement).toBeGreaterThanOrEqual(2);
  expect(observed.remaining).toBeGreaterThan(24);
  expect(observed.highlightedFrames).toBeGreaterThan(1);
  expect(observed.outsideFrames).toBe(0);
  await expect(page.getByTestId('session-search-dialog')).toBeHidden();
  await expect(page.locator('#chat-msg-20')).toBeInViewport();
  // 保留搜索自身的高亮释放 timer，并验证释放后普通导航仍可工作。
  await expect(page.locator('#chat-msg-20')).not.toHaveClass(/search-target/);
  await page.getByTestId('msg-rail-dot-chat-msg-0').click();
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeLessThan(24);
  await expect(page.locator('#chat-msg-0')).toBeInViewport();
});

for (const handoff of ['highlight expiry', 'alignment interval', 'return to bottom'] as const) {
  test(`search yields scroll ownership to a later user action: ${handoff}`, async ({ launchElectronApp }) => {
    const app = await launchElectronApp({
      withPi: true,
      agentDir,
      seedSettings: { workspaceCwd: workspace },
    });
    const page = await app.firstWindow();
    const trustDialog = page.getByTestId('trust-dialog');
    const modelReady = page.getByTestId('model-select').or(page.getByTestId('model-badge')).first();
    await expect(trustDialog.or(modelReady).first()).toBeVisible({ timeout: 30_000 });
    if (await trustDialog.isVisible()) {
      await trustDialog.getByTestId('trust-option').first().click();
      await expect(trustDialog).toBeHidden();
    }
    await expect(modelReady).toBeVisible({ timeout: 30_000 });
    const searchPhrase = `Say PONG search ownership ${handoff} ${Date.now()}`;
    // 首条问题也会匹配会话标题而不带 messageIndex；回底场景选第二条内容命中。
    const searchRound = handoff === 'return to bottom' ? 2 : 11;
    for (let i = 1; i <= 11; i++) {
      await page.getByTestId('chat-input').fill(i === searchRound ? searchPhrase : `Say PONG ${i}`);
      await page.getByTestId('chat-send').click();
      await expect(page.getByTestId('message-user')).toHaveCount(i, { timeout: 30_000 });
      await expect(page.getByTestId('message-assistant')).toHaveCount(i, { timeout: 30_000 });
    }
    const list = page.getByTestId('message-list');
    await expect.poll(() => list.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(2);
    await page.getByTestId('session-search-trigger').click();
    await page.getByTestId('session-search-input').fill(searchPhrase);
    const result = page.locator('[data-testid^="session-search-result-"]').filter({ hasText: searchPhrase });
    await expect(result).toHaveCount(1);
    await expect(result).toBeVisible();
    const resultId = await result.getAttribute('data-testid');

    // 原生 RAF、真实 scrollTop；只观察 2400ms timer 的注册时间来安排边界点击，
    // 不改 RAF 时间戳、不延迟高亮 cleanup，也不直接写滚动位置。
    const observed = await page.evaluate(({ resultId, handoff, searchRound }) => new Promise<{
      located: boolean; movement: number; remainingAtRelease: number; releaseAfterJump: number;
      frames: number; released: boolean; finalGap: number; largestSettledGap: number; outerTop: number;
    }>((resolve, reject) => {
      const list = document.querySelector<HTMLElement>('[data-testid="message-list"]')!;
      const searchTarget = () => document.getElementById(`chat-msg-${(searchRound - 1) * 2}`)!;
      const originalTimeout = window.setTimeout;
      let jumpTimer: number | undefined;
      let frame: number;
      let jumpedAt: number | undefined;
      let releasedAt: number | undefined;
      let startTop = 0;
      let located = false;
      let movement = 0;
      let remainingAtRelease = 0;
      let frames = 0;
      let largestSettledGap = 0;
      let sawHighlight = false;
      const gap = () => handoff === 'return to bottom'
        ? list.scrollHeight - list.clientHeight - list.scrollTop
        : Math.abs(document.getElementById('chat-msg-0')!.getBoundingClientRect().top
          - list.getBoundingClientRect().top - 8);
      const isLocated = () => {
        const target = searchTarget();
        const rect = target.getBoundingClientRect();
        const viewport = list.getBoundingClientRect();
        return target.classList.contains('search-target') && rect.bottom > viewport.top && rect.top < viewport.bottom;
      };
      const jump = () => {
        const button = document.querySelector<HTMLButtonElement>(handoff === 'return to bottom'
          ? '[data-testid="scroll-to-bottom"]'
          : '[data-testid="msg-rail-dot-chat-msg-0"]');
        // 搜索对齐后的 scroll 事件需要一次 React 提交才能显示回底按钮。
        if (!button) return;
        located = isLocated();
        startTop = list.scrollTop;
        jumpedAt = performance.now();
        button.click();
      };
      const cleanup = () => {
        window.setTimeout = originalTimeout;
        window.clearTimeout(jumpTimer);
        window.clearTimeout(deadline);
        cancelAnimationFrame(frame);
      };
      const deadline = originalTimeout(() => {
        cleanup();
        reject(new Error('Search handoff did not finish within 8s: ' + JSON.stringify({ located, jumpedAt, sawHighlight, releasedAt, frames, top: list.scrollTop, target: searchTarget().className })));
      }, 8_000);
      window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        const id = originalTimeout(handler, timeout, ...args);
        if (timeout === 2400) {
          window.setTimeout = originalTimeout;
          jumpTimer = originalTimeout(jump, handoff === 'highlight expiry' ? 2350 : 350);
        }
        return id;
      }) as typeof window.setTimeout;
      const sample = () => {
        const now = performance.now();
        const highlighted = searchTarget().classList.contains('search-target');
        sawHighlight ||= highlighted;
        if (jumpedAt !== undefined) {
          frames++;
          if (highlighted) movement = Math.max(movement, Math.abs(list.scrollTop - startTop));
          if (sawHighlight && !highlighted && releasedAt === undefined) {
            releasedAt = now;
            remainingAtRelease = gap();
          }
          if (now - jumpedAt >= 500) largestSettledGap = Math.max(largestSettledGap, gap());
          if (releasedAt !== undefined && now - releasedAt >= 600 && now - jumpedAt >= 900) {
            cleanup();
            resolve({ located, movement, remainingAtRelease, releaseAfterJump: releasedAt - jumpedAt,
              frames, released: true, finalGap: gap(), largestSettledGap,
              outerTop: document.querySelector<HTMLElement>('.content')!.scrollTop });
            return;
          }
        }
        frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
      document.querySelector<HTMLButtonElement>(`[data-testid="${resultId}"]`)!.click();
    }), { resultId, handoff, searchRound });
    console.log(`Search ownership (${handoff}): ${JSON.stringify(observed)}`);
    expect(observed.located).toBe(true);
    expect(observed.movement).toBeGreaterThanOrEqual(2);
    expect(observed.frames).toBeGreaterThan(1);
    expect(observed.released).toBe(true);
    if (handoff === 'highlight expiry') {
      // 必须先证明动画已移动且高亮在它尚未结束时释放，不能以首帧前取消充数。
      expect(observed.remainingAtRelease).toBeGreaterThan(24);
      expect(observed.releaseAfterJump).toBeGreaterThan(0);
      expect(observed.releaseAfterJump).toBeLessThan(320);
    }
    expect(observed.finalGap).toBeLessThanOrEqual(2);
    expect(observed.largestSettledGap).toBeLessThanOrEqual(2);
    expect(observed.outerTop).toBe(0);
    await expect(page.getByTestId('session-search-dialog')).toBeHidden();
    await expect(handoff === 'return to bottom'
      ? page.getByTestId('message-assistant').last()
      : page.locator('#chat-msg-0')).toBeInViewport();
  });
}
