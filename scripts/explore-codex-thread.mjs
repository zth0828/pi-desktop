// 展开 Codex 的「已处理 Xs」折叠行，看工具调用细节形态
import { chromium } from '@playwright/test';

const shotDir = '/tmp/codex-explore';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0].pages().find((p) => p.url().startsWith('app://'));
await page.bringToFront();
const shot = async (name) => { await page.screenshot({ path: `${shotDir}/${name}.png` }); console.log('shot:', name); };

const worked = page.locator('text=已处理').first();
await worked.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(800);
await worked.click().catch((e) => console.log('click fail', e.message));
await page.waitForTimeout(1200);
await shot('11-worked-expanded');
// 展开后往下滚一点看完整
await page.evaluate(() => {
  const els = [...document.querySelectorAll('*')].filter((el) => {
    const s = getComputedStyle(el);
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 100;
  });
  const main = els.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  if (main) main.scrollTop += 600;
});
await page.waitForTimeout(800);
await shot('12-worked-expanded-2');
await browser.close();
