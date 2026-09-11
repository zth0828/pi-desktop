// 主窗口关闭行为 E2E：
// - 默认模式（minimize）：关闭主窗口 → 隐藏不退出，可恢复；
// - 退出模式（quit）：关闭主窗口 → 直接退出应用。
import { expect, test } from './fixtures/electron';

test.describe('主窗口关闭行为', () => {
  test('默认模式（minimize）：关闭主窗口 → 隐藏不退出，可恢复', async ({ launchElectronApp }) => {
    const app = await launchElectronApp();
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // 模拟用户点窗口关闭按钮（被拦截为 hide），随后通过 Dock/托盘恢复
    const result = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.close();
      const hiddenState = {
        count: BrowserWindow.getAllWindows().length,
        destroyed: win.isDestroyed(),
        visible: win.isVisible(),
      };

      win.show();
      win.focus();

      return {
        ...hiddenState,
        restoredVisible: win.isVisible(),
      };
    });

    expect(result.count).toBe(1);
    expect(result.destroyed).toBe(false);
    expect(result.visible).toBe(false);
    expect(result.restoredVisible).toBe(true);
  });

  test('配置 closeAction 为 quit：关闭主窗口直接退出应用', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({
      seedSettings: { closeAction: 'quit' },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    const closePromise = app.waitForEvent('close', { timeout: 10_000 });
    // 点击关闭按钮触发 close
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].close();
    });

    // 进程应该退出
    await closePromise;
  });

  test('退出流程不被 close 拦截卡住（before-quit 放行）', async ({ launchElectronApp }) => {
    const app = await launchElectronApp();
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // app.quit() 走 before-quit → setQuitting(true) → 主窗口 close 放行 → 应用退出。
    const closePromise = app.waitForEvent('close', { timeout: 10_000 });
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await closePromise;
  });
});
