// 手动性能验证：
// 3 面板并发 SLOW_ECHO 慢速流式期间，测量输入框打字响应与主线程帧率。
// 指标：流式窗口内 rAF 帧率、longtask 次数/总时长、input 事件到下一帧的延迟（均值/p95）。
// 断言：三个面板各自流式完整落地、互不串台（回复带各自 PANE 标记）。
// 用法: node scripts/verify-panes-perf.mjs
// 依赖：.cache/pi-test-prefix 的测试用 pi（同 tests/helpers/pi-prefix.ts；缺了会自动装），
//       dist-electron 已构建（先跑 pnpm build:vite 或 pnpm test:e2e 任一即可）。
import electronBinaryPathImport from 'electron';
import { _electron as electron } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import path, { join, resolve } from 'node:path';

const electronBinaryPath = electronBinaryPathImport;
const repoRoot = resolve(process.cwd());
const electronEntry = join(repoRoot, 'dist-electron/main/index.js');
const shotDir = '/tmp/pi-desktop-panes-perf';

// --- pi 测试前缀（与 tests/helpers/pi-prefix.ts 同布局，mjs 无法 import ts 故就地复刻） ---
const PI_PREFIX = join(repoRoot, '.cache/pi-test-prefix');
const PI_NPM_ROOT = join(PI_PREFIX, 'lib/node_modules');
const PI_BIN_DIR = join(PI_PREFIX, 'bin');
if (!existsSync(join(PI_NPM_ROOT, '@earendil-works/pi-coding-agent/package.json'))) {
  console.log('[perf] installing test pi into .cache/pi-test-prefix ...');
  execFileSync('npm', ['i', '-g', '--prefix', PI_PREFIX, '@earendil-works/pi-coding-agent@^0.83.0'], {
    stdio: 'inherit',
    timeout: 300_000,
  });
}

// --- mock provider（同 tests/e2e/multi-window.spec.ts 模式，不烧 API quota） ---
const mock = spawn(process.execPath, [join(repoRoot, 'tests/fixtures/mock-openai-server.mjs')]);
const mockPort = await new Promise((resolvePort, reject) => {
  mock.stdout?.on('data', (d) => {
    const m = String(d).match(/MOCK_PORT=(\d+)/);
    if (m) resolvePort(Number(m[1]));
  });
  setTimeout(() => reject(new Error('mock server timeout')), 10_000);
});

const homeDir = await mkdtemp(join(tmpdir(), 'pi-desktop-perf-home-'));
const agentDir = join(homeDir, 'agent');
const workspace = await mkdtemp(join(tmpdir(), 'pi-desktop-perf-workspace-'));
await mkdir(agentDir, { recursive: true });
await mkdir(shotDir, { recursive: true });
await writeFile(
  join(agentDir, 'models.json'),
  JSON.stringify({
    providers: {
      mock: {
        baseUrl: `http://127.0.0.1:${mockPort}/v1`,
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
  }),
);
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'mock', defaultModel: 'mock-1' }));
await mkdir(join(homeDir, 'user-data'), { recursive: true });
await writeFile(join(homeDir, 'user-data/config.json'), JSON.stringify({ workspaceCwd: workspace }));

const app = await electron.launch({
  executablePath: electronBinaryPath,
  args: ['--lang=en-US', electronEntry],
  env: {
    ...process.env,
    HOME: homeDir,
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    PI_DESKTOP_USER_PATH: `${PI_BIN_DIR}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
    PI_DESKTOP_NPM_ROOT: PI_NPM_ROOT,
    PI_CODING_AGENT_DIR: agentDir,
    PI_DESKTOP_USER_DATA_DIR: join(homeDir, 'user-data'),
  },
  timeout: 60_000,
});

const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
const log = (...args) => console.log('[perf]', ...args);
const pane = (i) => page.locator('.pane-leaf').nth(i);

async function waitSessionReady(paneLocator = page) {
  await paneLocator.getByTestId('model-select').or(paneLocator.getByTestId('model-badge')).first()
    .waitFor({ state: 'visible', timeout: 30_000 });
}

/** 轮询 scope（Page 或 pane Locator）内最后一条 assistant 消息直到包含指定文本 */
async function waitLastAssistantContains(scope, text, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const items = scope.getByTestId('message-assistant');
    const count = await items.count();
    if (count > 0 && ((await items.last().textContent()) ?? '').includes(text)) return;
    if (Date.now() > deadline) throw new Error(`timeout waiting assistant text: ${text}`);
    await page.waitForTimeout(200);
  }
}

/** 发一条消息并等 mock 回复落地（PONG），scope 缺省为整个页面（单面板时） */
async function sendAndWaitPong(scope, text) {
  await scope.getByTestId('chat-input').fill(text);
  await scope.getByTestId('chat-send').click();
  await waitLastAssistantContains(scope, 'PONG');
}

/** 侧栏会话行 title 属性即会话文件路径 */
async function sessionPathOf(text) {
  const row = page.locator('.sidebar-session-row').filter({ hasText: text });
  await row.locator('[data-testid^="sidebar-session-"]').first().waitFor({ timeout: 15_000 });
  return row.locator('[data-testid^="sidebar-session-"]').first().getAttribute('title');
}

/** 模拟把侧栏会话拖入指定面板的右缘落区（分栏）。payload 必须带 cwd（同 SessionList
 *  dragstart）：缺 cwd 时 main 侧 switch 会退化为改绑全局 active runtime，抢走别的
 *  面板正在用的会话。 */
async function dropSessionIntoPane(sessionPath, paneIndex, cwd) {
  await page.evaluate(({ sessionPath: p, paneIndex: i, cwd: c }) => {
    const target = document.querySelectorAll('.pane-leaf')[i];
    const rect = target.getBoundingClientRect();
    const dt = new DataTransfer();
    dt.setData('application/x-pi-session', JSON.stringify({ sessionPath: p, cwd: c }));
    target.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX: rect.right - 10,
      clientY: rect.top + rect.height / 2,
      dataTransfer: dt,
    }));
  }, { sessionPath, paneIndex, cwd });
}

async function newSessionInPane(scope) {
  await scope.getByTestId('chat-input').fill('/new');
  await scope.getByTestId('chat-send').click();
  await scope.getByTestId('chat-greeting').waitFor({ state: 'visible', timeout: 15_000 });
}

async function dumpPanes(label) {
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('.pane-leaf')].map((el) => el.getAttribute('data-testid')));
  log(label, 'panes:', JSON.stringify(ids));
}

let failed = false;
try {
  await page.getByTestId('chat-input').waitFor({ state: 'visible', timeout: 30_000 });
  await waitSessionReady();

  // 造 3 个会话并拖成 3 个并排面板：pane0=gamma pane1=alpha pane2=beta
  await sendAndWaitPong(page, 'hello alpha');
  await newSessionInPane(page);
  await sendAndWaitPong(page, 'hello beta');
  await dumpPanes('before drop1');
  await dropSessionIntoPane(await sessionPathOf('hello alpha'), 0, workspace);
  await page.locator('.pane-leaf').nth(1).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(800);
  await dumpPanes('after drop1');
  await pane(1).getByTestId('message-user').first().waitFor({ timeout: 15_000 });
  await dumpPanes('before /new pane0');
  await newSessionInPane(pane(0));
  await sendAndWaitPong(pane(0), 'hello gamma');
  await dropSessionIntoPane(await sessionPathOf('hello beta'), 0, workspace);
  await page.locator('.pane-leaf').nth(2).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(800);
  await dumpPanes('after drop2');
  await pane(1).getByTestId('message-user').first().waitFor({ timeout: 15_000 });
  log('3 panes ready:', await page.locator('.pane-leaf').count());

  // 3 面板并发 SLOW_ECHO（~155 字符回显 ≈ 20 chunk × 100ms ≈ 2s 慢速流）
  const filler = 'x'.repeat(120);
  for (let i = 0; i < 3; i += 1) {
    await pane(i).getByTestId('chat-input').fill(`SLOW_ECHO PANE-${i} MARKER ${filler}`);
    await pane(i).getByTestId('chat-send').click();
  }

  // 测量窗口：rAF 帧率 + longtask + pane0 输入框 input→下一帧延迟
  await page.evaluate(() => {
    window.__metrics = { frames: 0, longtasks: [], inputLat: [] };
    const tick = () => { window.__metrics.frames += 1; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__metrics.longtasks.push(Math.round(e.duration));
      }).observe({ entryTypes: ['longtask'] });
    } catch { /* longtask 不可用时跳过 */ }
    const input = document.querySelectorAll('.pane-leaf')[0].querySelector('[data-testid="chat-input"]');
    input.addEventListener('input', () => {
      const t0 = performance.now();
      requestAnimationFrame(() => window.__metrics.inputLat.push(Math.round((performance.now() - t0) * 10) / 10));
    });
  });
  const t0 = Date.now();

  // 流式期间在 pane0 输入框打字（40 字符 ≈ 1s）
  await pane(0).getByTestId('chat-input').click();
  await page.keyboard.type('typing while three panes stream........', { delay: 25 });
  await page.screenshot({ path: join(shotDir, 'streaming-3-panes.png') });

  // 等三个面板各自流式完整落地（互不串台：回复带各自 PANE 标记）
  for (let i = 0; i < 3; i += 1) {
    await waitLastAssistantContains(pane(i), `PANE-${i}`);
  }
  const elapsed = Date.now() - t0;

  const metrics = await page.evaluate(() => window.__metrics);
  const lat = metrics.inputLat.sort((a, b) => a - b);
  const avg = lat.length ? (lat.reduce((s, v) => s + v, 0) / lat.length).toFixed(1) : 'n/a';
  const p95 = lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] : 'n/a';
  log(`window: ${elapsed}ms, frames: ${metrics.frames} (~${Math.round(metrics.frames / (elapsed / 1000))} fps)`);
  log(`longtasks(>50ms): ${metrics.longtasks.length}`, metrics.longtasks.length ? metrics.longtasks : '');
  log(`input->next-frame latency ms: n=${lat.length} avg=${avg} p95=${p95} max=${lat[lat.length - 1] ?? 'n/a'}`);
  const inputValue = await pane(0).getByTestId('chat-input').inputValue();
  log('typed text fully landed:', inputValue.startsWith('typing while three panes stream'));
  await page.screenshot({ path: join(shotDir, 'completed-3-panes.png') });
  log('screenshots in', shotDir);
} catch (err) {
  failed = true;
  console.error('[perf] FAILED:', err);
  await dumpPanes('on-failure').catch(() => {});
  await page.evaluate(() =>
    [...document.querySelectorAll('.pane-leaf')].map((el) => ({
      id: el.getAttribute('data-testid'),
      attaching: el.querySelector('[data-testid="chat-attaching"]')?.textContent ?? null,
      greeting: Boolean(el.querySelector('[data-testid="chat-greeting"]')),
      inputs: el.querySelectorAll('[data-testid="chat-input"]').length,
      errorBanner: el.querySelector('.error-banner')?.textContent ?? null,
      workspacePanel: Boolean(el.querySelector('.workspace-panel')),
    }))).then((s) => log('leaf states:', JSON.stringify(s, null, 1))).catch(() => {});
  await page.screenshot({ path: join(shotDir, 'failure.png') }).catch(() => {});
} finally {
  await app.close().catch(() => app.process().kill('SIGKILL'));
  mock.kill();
}
process.exit(failed ? 1 : 0);
