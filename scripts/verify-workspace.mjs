// Real desktop verification: connect to a running Pi Desktop CDP endpoint and
// exercise the workspace/review panel plus the configured LM Studio model.
import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const port = process.env.PI_DESKTOP_CDP_PORT ?? '9333';
const outDir = path.join(process.cwd(), 'output/playwright');
await mkdir(outDir, { recursive: true });

const nativeModels = await fetch('http://127.0.0.1:1234/api/v1/models').then((response) => response.json());
const qwen = nativeModels.models?.find((model) => model.key === 'qwen/qwen3.5-9b');
const configured = JSON.parse(await readFile(path.join(process.env.HOME, '.pi/agent/models.json'), 'utf8'));
const configuredQwen = configured.providers?.lmstudio?.models?.find((model) => model.id === 'qwen/qwen3.5-9b');
console.log('lmstudio-context', {
  maximum: qwen?.max_context_length,
  loaded: qwen?.loaded_instances?.[0]?.config?.context_length,
  configured: configuredQwen?.contextWindow,
  maxOutput: configuredQwen?.maxTokens,
});

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) =>
  candidate.url().startsWith('file:') || candidate.url().startsWith('http://localhost'),
);
if (!page) throw new Error('Pi Desktop page not found');
await page.bringToFront();
await page.getByTestId('workspace-toggle').waitFor({ timeout: 30_000 });
await page.screenshot({ path: path.join(outDir, 'workspace-01-chat.png') });

await page.getByTestId('workspace-toggle').click();
await page.getByTestId('review-panel').waitFor();
await page.screenshot({ path: path.join(outDir, 'workspace-02-files.png') });
const textFile = page.getByTestId('workspace-file').filter({ hasText: 'a.txt' });
if (await textFile.count()) {
  await textFile.click();
  await page.getByTestId('workspace-text-preview').waitFor();
  await page.screenshot({ path: path.join(outDir, 'workspace-02a-text-preview.png') });
}
await page.getByTestId('workspace-files-tab').click();
const imageFile = page.getByTestId('workspace-file').filter({ hasText: 'test-image.png' });
if (await imageFile.count()) {
  await imageFile.click();
  await page.getByTestId('workspace-image-preview').waitFor();
  await page.screenshot({ path: path.join(outDir, 'workspace-02b-image-preview.png') });
}
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await page.screenshot({ path: path.join(outDir, 'workspace-02c-dark.png') });
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
await page.getByTestId('workspace-review-tab').click();
await page.screenshot({ path: path.join(outDir, 'workspace-03-review.png') });
await page.getByTestId('workspace-close').click();

if (await page.getByTestId('model-select').count()) {
  await page.getByTestId('model-select').click();
  await page.getByTestId('model-menu-models').click();
  await page.locator('[data-testid="model-option"][data-value="lmstudio/qwen/qwen3.5-9b"]').click();
}
await page.getByTestId('token-usage').click();
await page.getByTestId('token-usage-popover').waitFor();
console.log('usage-popover', (await page.getByTestId('token-usage-popover').innerText()).replaceAll('\n', ' | '));
await page.screenshot({ path: path.join(outDir, 'workspace-04-lmstudio-usage.png') });
await page.getByTestId('chat-input').click();

if (process.env.PI_DESKTOP_VERIFY_PROMPT === '1') {
  const assistants = page.getByTestId('message-assistant');
  const before = await assistants.count();
  await page.getByTestId('chat-input').fill('只回复 CONTEXT_OK');
  await page.getByTestId('chat-send').click();
  await assistants.nth(before).waitFor({ timeout: 180_000 });
  await page.getByTestId('chat-send').waitFor({ timeout: 180_000 });
  console.log('assistant', (await assistants.nth(before).innerText()).slice(0, 300));
  await page.screenshot({ path: path.join(outDir, 'workspace-05-lmstudio-turn.png') });
}

await browser.close();
