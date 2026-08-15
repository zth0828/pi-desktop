// 独立窗口打开耗时测量：PI_DESKTOP_TIMING=1 插桩（electron/utils/timing.ts +
// src/lib/timing.ts），main 侧 [timing] 行从进程 stdout 收集，渲染层从 console 收集。
// 用法: node scripts/measure-detach-timing.mjs（需先 pnpm run build:vite）
import electronBinaryPathImport from 'electron';
import { _electron as electron } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join, resolve } from 'node:path';
// pi 测试前缀（tests/helpers/pi-prefix.ts 的 .mjs 内联版，macOS 布局）：.cache/pi-test-prefix
const PI_PREFIX = resolve('.cache/pi-test-prefix');
const piEnv = { npmRoot: join(PI_PREFIX, 'lib/node_modules'), piBinDir: join(PI_PREFIX, 'bin') };
const electronBinaryPath = electronBinaryPathImport;
const electronEntry = join(resolve(process.cwd()), 'dist-electron/main/index.js');
const nodeBinDir = path.dirname(process.execPath);

// mock provider（同 tests/e2e 模式，不烧真实 quota）
const mock = spawn(process.execPath, [join(process.cwd(), 'tests/fixtures/mock-openai-server.mjs')]);
const mockPort = await new Promise((resolvePort, reject) => {
  mock.stdout.on('data', (d) => {
    const m = String(d).match(/MOCK_PORT=(\d+)/);
    if (m) resolvePort(Number(m[1]));
  });
  setTimeout(() => reject(new Error('mock server timeout')), 10_000);
});

const homeDir = await mkdtemp(join(tmpdir(), 'pi-desktop-timing-home-'));
const agentDir = await mkdtemp(join(tmpdir(), 'pi-desktop-timing-agent-'));
const workspace = await mkdtemp(join(tmpdir(), 'pi-desktop-timing-workspace-'));
await writeFile(
  join(agentDir, 'models.json'),
  JSON.stringify({
    providers: {
      mock: {
        baseUrl: `http://127.0.0.1:${mockPort}/v1`,
        api: 'openai-completions',
        apiKey: 'mock-key',
        models: [{
          id: 'mock-1', name: 'Mock 1', reasoning: false, input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000, maxTokens: 4096,
        }],
      },
    },
  }),
);
await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'mock', defaultModel: 'mock-1' }));
const userDataDir = join(homeDir, 'user-data');
await mkdir(userDataDir, { recursive: true });
await writeFile(join(userDataDir, 'config.json'), JSON.stringify({ workspaceCwd: workspace }));

const marks = []; // { t, label, source }
const debugLog = []; // 失败诊断用：最近的页面 console / main 输出
const note = (line) => { debugLog.push(line); if (debugLog.length > 200) debugLog.shift(); };
const collect = (source) => (line) => {
  const m = line.match(/\[timing\]\s+(\d+)\s+(\S+)/);
  if (m) marks.push({ t: Number(m[1]), label: m[2], source });
};

const app = await electron.launch({
  executablePath: electronBinaryPath,
  args: ['--lang=zh-CN', electronEntry],
  env: {
    ...process.env,
    HOME: homeDir,
    PI_DESKTOP_USER_PATH: `${piEnv.piBinDir}:${nodeBinDir}:/usr/bin:/bin`,
    PI_DESKTOP_NPM_ROOT: piEnv.npmRoot,
    PI_CODING_AGENT_DIR: agentDir,
    PI_DESKTOP_USER_DATA_DIR: userDataDir,
    PI_DESKTOP_TIMING: '1',
  },
  timeout: 60_000,
});
app.process().stdout.on('data', (d) => String(d).split('\n').forEach((l) => { note(`[main] ${l}`); collect('main')(l); }));
app.process().stderr.on('data', (d) => String(d).split('\n').forEach((l) => { note(`[main-err] ${l}`); collect('main-err')(l); }));

const watchConsole = (page, source) => page.on('console', (msg) => { note(`[${source}] ${msg.text()}`); collect(source)(msg.text()); });

try {
  const page = await app.firstWindow();
  watchConsole(page, 'mainWin');
  await page.getByTestId('model-select').or(page.getByTestId('model-badge')).first().waitFor({ timeout: 30_000 });

  // 造两个会话：ALPHA 稍后 detach，BETA 占用主窗口绑定
  // （同会话已有窗口绑定会被 createSessionWindow 聚焦复用，不开新窗口）
  await page.getByTestId('chat-input').fill('Say PONG timing ALPHA');
  await page.getByTestId('chat-send').click();
  await page.getByTestId('message-assistant').last().waitFor({ timeout: 30_000 });
  await page.getByTestId('new-chat').click();
  await page.getByTestId('chat-input').fill('Say PONG main BETA');
  await page.getByTestId('chat-send').click();
  await page.getByTestId('message-assistant').last().waitFor({ timeout: 30_000 });

  // 右键 → 在独立窗口打开
  const row = page.locator('.sidebar-session-row').filter({ hasText: 'timing ALPHA' });
  const sessionButton = row.locator('[data-testid^="sidebar-session-"]').first();
  const sessionId = (await sessionButton.getAttribute('data-testid')).replace('sidebar-session-', '');
  const windowPromise = app.waitForEvent('window');
  let detached;
  try {
    await row.click({ button: 'right' });
    await page.getByTestId(`sidebar-session-open-detached-${sessionId}`).click();
    detached = await windowPromise;
  } catch (err) {
    await mkdir('/tmp/pi-desktop-timing', { recursive: true });
    await page.screenshot({ path: '/tmp/pi-desktop-timing/fail.png' }).catch(() => {});
    console.log('openDetached 失败，最近日志：');
    for (const l of debugLog.slice(-60)) console.log(l);
    throw err;
  }
  watchConsole(detached, 'detached');
  // 等到独立窗口首条历史消息渲染（attach 完成的使用体感终点）
  await detached.getByTestId('message-user').first().waitFor({ timeout: 30_000 });
  marks.push({ t: Date.now(), label: 'e2e:first-message-visible', source: 'script' });

  // 汇总输出
  const sorted = marks.sort((a, b) => a.t - b.t);
  const t0 = sorted.find((m) => m.label === 'openDetached:recv')?.t ?? sorted[0].t;
  console.log('\n=== 独立窗口打开各段耗时（相对 openDetached:recv，ms）===');
  for (const m of sorted) {
    console.log(`${String(m.t - t0).padStart(6)}  [${m.source}] ${m.label}`);
  }
} finally {
  await app.close().catch(() => {});
  mock.kill();
  await rm(homeDir, { recursive: true, force: true });
  await rm(agentDir, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
}
