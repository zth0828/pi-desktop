// Codex 设置页 + composer 细节探索 v2（force 点击）
import { chromium } from '@playwright/test';

const shotDir = '/tmp/codex-explore';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0].pages().find((p) => p.url().startsWith('app://'));
await page.bringToFront();
const shot = async (name) => { await page.screenshot({ path: `${shotDir}/${name}.png` }); console.log('shot:', name); };

// 模型选择器
const modelSel = page.locator('[class*=ModelPickerTrigger]').first();
if (await modelSel.count()) {
  await modelSel.click({ force: true });
  await page.waitForTimeout(1000);
  await shot('21-model-selector');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

// composer 的 + 按钮（输入框左侧）
const plusBtn = page.locator('[class*=Composer] button, [class*=composer] button').first();
if (await plusBtn.count()) {
  await plusBtn.click({ force: true });
  await page.waitForTimeout(800);
  await shot('20-composer-plus');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

// 用户菜单 → 设置
await page.locator('text=tianhong').first().click({ force: true }).catch(() => {});
await page.waitForTimeout(1000);
await shot('22-user-menu');
const settingsEntry = page.locator('text=设置').first();
if (await settingsEntry.count()) {
  await settingsEntry.click({ force: true }).catch(() => {});
  await page.waitForTimeout(1500);
  await shot('23-settings');
  // 设置页滚一下
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(600);
  await shot('24-settings-2');
}
await browser.close();
