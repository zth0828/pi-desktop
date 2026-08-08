// 抓 Codex 设置的 外观 / Git / 环境 / Worktrees 页
import { chromium } from '@playwright/test';

const shotDir = '/tmp/codex-explore';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0].pages().find((p) => p.url().startsWith('app://'));
await page.bringToFront();
const shot = async (name) => { await page.screenshot({ path: `${shotDir}/${name}.png` }); console.log('shot:', name); };

for (const name of ['外观', 'Git', '环境', 'Worktrees']) {
  const item = page.locator(`text="${name}"`).first();
  if (!(await item.count())) { console.log('missing:', name); continue; }
  await item.click({ force: true }).catch((e) => console.log(name, 'click fail'));
  await page.waitForTimeout(1200);
  await shot(`32-settings-${name}`);
}
await browser.close();
