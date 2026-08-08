// 探索本机 Codex 桌面端 UI（CDP 连接，只读浏览 + 截图）
// 用法: node scripts/explore-codex.mjs [动作...]
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const shotDir = '/tmp/codex-explore';
await mkdir(shotDir, { recursive: true });

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const contexts = browser.contexts();
console.log('contexts:', contexts.length);
let page = null;
for (const ctx of contexts) {
  for (const p of ctx.pages()) {
    console.log('page:', p.url().slice(0, 80));
    if (p.url().startsWith('app://')) page = p;
  }
}
if (!page) {
  console.log('no app page found');
  process.exit(1);
}
await page.bringToFront();
await page.waitForTimeout(1500);

const shot = async (name) => {
  await page.screenshot({ path: `${shotDir}/${name}.png` });
  console.log('shot:', name);
};

await shot('01-initial');

// 侧栏结构：列出可见的导航/按钮文本
const navTexts = await page.locator('nav a, nav button, [class*=sidebar] a, [class*=sidebar] button').allTextContents().catch(() => []);
console.log('nav items:', JSON.stringify(navTexts.map((s) => s.trim()).filter(Boolean).slice(0, 30)));

// 最近会话列表
const threadLinks = await page.locator('a[href*="thread"], a[href*="/t/"], [class*=thread], [class*=conversation], [class*=chat-list] a').allTextContents().catch(() => []);
console.log('threads:', JSON.stringify(threadLinks.map((s) => s.trim()).filter(Boolean).slice(0, 15)));

await browser.close();
