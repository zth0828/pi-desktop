// Skills 页 —— 活动 runtime 的 resourceLoader.getSkills() 列表。
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures/electron';
import { seedTrustedWorkspace } from '../helpers/trust';

let mock: ChildProcess;
let agentDir: string;
let workspace: string;
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

  workspace = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-workspace-'));
  // 项目级 skill：.pi/skills/test-skill/SKILL.md
  await mkdir(path.join(workspace, '.pi/skills/test-skill'), { recursive: true });
  await writeFile(
    path.join(workspace, '.pi/skills/test-skill/SKILL.md'),
    '---\nname: test-skill\ndescription: A test skill for E2E\n---\nDo the test thing.\n',
  );
});

test.beforeEach(async () => {
  agentDir = await mkdtemp(path.join(tmpdir(), 'pi-desktop-e2e-agent-'));
  await seedTrustedWorkspace(agentDir, workspace);
  await writeFile(
    path.join(workspace, '.pi/skills/test-skill/SKILL.md'),
    '---\nname: test-skill\ndescription: A test skill for E2E\n---\nDo the test thing.\n',
  );
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
  await rm(agentDir, { recursive: true, force: true });
});

test.afterAll(async () => {
  mock?.kill();
  await rm(workspace, { recursive: true, force: true });
});

test('Skills 页：项目 .pi/skills 里的 skill 出现在列表并标注来源', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace },
  });
  const page = await app.firstWindow();

  // 等 runtime 启动（Chat 页自动 start），再进 Skills 页
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('nav-skills').click();
  const row = page.getByTestId('skill-row-test-skill');
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText('A test skill for E2E');
  await expect(row.getByTestId('skill-source')).toContainText(/project/i);
});

test('Skills 页：查看 skill 内容弹窗与模式切换', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace, language: 'zh' },
  });
  const page = await app.firstWindow();
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('nav-skills').click();
  await page.getByTestId('skill-view-test-skill').click();
  const overlay = page.getByTestId('skill-view-overlay');
  await expect(overlay).toBeVisible({ timeout: 15_000 });
  await expect(overlay).toContainText('Do the test thing.');
  await expect(overlay).toContainText('自动感知');

  // 在弹窗内点击切换为仅手动
  const modalToggle = overlay.locator('.skill-view-mode-btn');
  await modalToggle.click();
  await expect(overlay).toContainText('仅手动调用', { timeout: 10_000 });

  await page.getByTestId('skill-view-close').click();
  await expect(overlay).toHaveCount(0);
});

test('Skills 页：5个以上技能在自动感知模式时显示智能优化横幅并支持一键全部转仅手动', async ({
  launchElectronApp,
}) => {
  // 创建 5 个额外技能（共 6 个）
  for (let i = 1; i <= 5; i++) {
    await mkdir(path.join(workspace, `.pi/skills/skill-${i}`), { recursive: true });
    await writeFile(
      path.join(workspace, `.pi/skills/skill-${i}/SKILL.md`),
      `---\nname: skill-${i}\ndescription: Auto skill ${i}\n---\nBody ${i}\n`,
    );
  }

  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace, language: 'zh' },
  });
  const page = await app.firstWindow();
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('nav-skills').click();
  const banner = page.getByTestId('skills-recommendation-banner');
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toContainText('检测到 6 个技能处于【自动感知】模式');

  // 点击一键全部设为仅手动
  const batchBtn = page.getByTestId('skills-batch-optimize-btn');
  await batchBtn.click();
  await expect(banner).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('skills-filter-manual')).toContainText('仅手动 (6)');

  // 验证清理新增技能
  for (let i = 1; i <= 5; i++) {
    await rm(path.join(workspace, `.pi/skills/skill-${i}`), { recursive: true, force: true });
  }
});

test('Skills 页：从 Claude 目录导入 skill（复制 + 同名唯一性）', async ({
  launchElectronApp,
  homeDir,
}) => {
  // 外部来源：homeDir/.claude/skills/{brand-new-skill, conflict-skill}
  // 导入目标：agentDir/skills（conflict-skill 已存在且内容不同 → conflict）
  const claudeSkills = path.join(homeDir, '.claude', 'skills');
  await mkdir(path.join(claudeSkills, 'brand-new-skill'), { recursive: true });
  await writeFile(
    path.join(claudeSkills, 'brand-new-skill', 'SKILL.md'),
    '---\nname: brand-new-skill\ndescription: from claude\n---\nBrand new.\n',
  );
  await mkdir(path.join(claudeSkills, 'conflict-skill'), { recursive: true });
  await writeFile(
    path.join(claudeSkills, 'conflict-skill', 'SKILL.md'),
    '---\nname: conflict-skill\n---\nIncoming version.\n',
  );
  await mkdir(path.join(agentDir, 'skills', 'conflict-skill'), { recursive: true });
  await writeFile(
    path.join(agentDir, 'skills', 'conflict-skill', 'SKILL.md'),
    '---\nname: conflict-skill\n---\nExisting version.\n',
  );

  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace },
  });
  const page = await app.firstWindow();
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('nav-skills').click();
  await page.getByTestId('skills-import-open').click();
  const dialog = page.getByTestId('skills-import-dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  // 状态标注：new 默认勾选；conflict 默认不勾、选择「保留两者」策略
  await expect(page.getByTestId('skill-import-status-brand-new-skill')).toContainText(/可导入|ready/i);
  await expect(page.getByTestId('skill-import-check-brand-new-skill')).toBeChecked();
  await expect(page.getByTestId('skill-import-status-conflict-skill')).toContainText(/同名冲突|conflict/i);
  await page.getByTestId('skill-import-check-conflict-skill').check();
  await page.getByTestId('skill-import-strategy-conflict-skill').selectOption('rename');

  await page.getByTestId('skills-import-confirm').click();
  await expect(page.getByTestId('skills-import-summary')).toContainText(/2/, { timeout: 15_000 });

  // 落盘验证：新 skill 复制进目标；冲突项以副本名并存，原文件不动
  const imported = path.join(agentDir, 'skills', 'brand-new-skill', 'SKILL.md');
  await expect(readFile(imported, 'utf8')).resolves.toContain('Brand new.');
  const renamedCopy = path.join(agentDir, 'skills', 'conflict-skill-2', 'SKILL.md');
  await expect(readFile(renamedCopy, 'utf8')).resolves.toContain('Incoming version.');
  const original = path.join(agentDir, 'skills', 'conflict-skill', 'SKILL.md');
  await expect(readFile(original, 'utf8')).resolves.toContain('Existing version.');
});

test('Skills 页：切换调用模式（自动感知 <-> 仅手动）并写入 SKILL.md 与模式过滤', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace },
  });
  const page = await app.firstWindow();
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('nav-skills').click();
  const toggleBtn = page.getByTestId('skill-mode-toggle-test-skill');
  await expect(toggleBtn).toBeVisible({ timeout: 15_000 });
  await expect(toggleBtn).toHaveClass(/mode-auto/);

  // 点击切换为仅手动
  await toggleBtn.click();
  await expect(toggleBtn).toHaveClass(/mode-manual/, { timeout: 10_000 });

  // 验证磁盘写入
  const skillFile = path.join(workspace, '.pi/skills/test-skill/SKILL.md');
  const contentAfterDisable = await readFile(skillFile, 'utf8');
  expect(contentAfterDisable).toContain('disable-model-invocation: true');

  // 测试过滤 Tab
  await page.getByTestId('skills-filter-manual').click();
  await expect(page.getByTestId('skill-row-test-skill')).toBeVisible();
  await page.getByTestId('skills-filter-auto').click();
  await expect(page.getByTestId('skill-row-test-skill')).toHaveCount(0);
  await page.getByTestId('skills-filter-all').click();
  await expect(page.getByTestId('skill-row-test-skill')).toBeVisible();

  // 点击切回自动感知
  await toggleBtn.click();
  await expect(toggleBtn).toHaveClass(/mode-auto/, { timeout: 10_000 });
  const contentAfterEnable = await readFile(skillFile, 'utf8');
  expect(contentAfterEnable).not.toContain('disable-model-invocation: true');
});

test('Chat 消息流：指定 Skill 触发后渲染折叠指令卡片，且用户气泡无 raw XML', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace },
  });
  const page = await app.firstWindow();
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });

  // 发送带 /skill:test-skill 的消息
  const chatInput = page.getByTestId('chat-input');
  await chatInput.fill('/skill:test-skill Please help with testing');
  await page.keyboard.press('Enter');

  // 用户消息应该出现折叠卡片
  const skillCard = page.getByTestId('message-skill-test-skill');
  await expect(skillCard).toBeVisible({ timeout: 15_000 });
  // 用户文本气泡中只包含纯文本，绝无 <skill> 或 </skill>
  const userText = page.getByTestId('message-user-text');
  await expect(userText).toContainText('Please help with testing');
  await expect(userText).not.toContainText('<skill');
  await expect(userText).not.toContainText('</skill>');

  // 点击展开技能卡片
  await page.getByTestId('message-skill-toggle-test-skill').click();
  const skillBody = page.getByTestId('message-skill-body-test-skill');
  await expect(skillBody).toBeVisible();
  await expect(skillBody).toContainText('Do the test thing.');
});

test('Skills 界面中英文与自动感知视觉验证', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({
    withPi: true,
    agentDir,
    seedSettings: { workspaceCwd: workspace, language: 'zh' },
  });
  const page = await app.firstWindow();
  await expect(
    page.getByTestId('model-select').or(page.getByTestId('model-badge')).first(),
  ).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('nav-skills').click();
  const toggleBtn = page.getByTestId('skill-mode-toggle-test-skill');
  await expect(toggleBtn).toBeVisible({ timeout: 15_000 });
  await expect(toggleBtn).toHaveClass(/mode-auto/);

  // 切换至聊天并发送技能指令，验证中文技能卡片
  await page.getByTestId('nav-chat').click();
  const chatInput = page.getByTestId('chat-input');
  await chatInput.fill('/skill:test-skill 请帮我测试');
  await page.keyboard.press('Enter');

  const skillCard = page.getByTestId('message-skill-test-skill');
  await expect(skillCard).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('message-skill-toggle-test-skill').click();
});


