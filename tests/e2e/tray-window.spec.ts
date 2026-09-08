// 主窗口关闭行为 E2E：
// - 默认模式（minimize）：关闭主窗口 → 隐藏不退出，可恢复；
// - 退出模式（quit）：关闭主窗口 → 直接退出应用。
import { expect, test } from './fixtures/electron';

test.describe('主窗口关闭行为', () => {
  test('默认模式（minimize）：关闭主窗口 → 隐藏不退出，可恢复', async ({ launchElectronApp }) => {
    const app = await launchElectronApp();
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // 模拟用户点窗口关闭按钮
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].close();
    });

    // 应用未退出：主窗口 hide（未销毁、不可见）
    const state = await app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      return {
        count: wins.length,
        destroyed: wins.map((w) => w.isDestroyed()),
        visible: wins.map((w) => w.isVisible()),
      };
    });
    expect(state.count).toBe(1);
    expect(state.destroyed).toEqual([false]);
    expect(state.visible).toEqual([false]);

    // 恢复（Dock / 托盘唤醒路径）：show + focus 后窗口可见
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.show();
      win.focus();
    });
    const visible = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible(),
    );
    expect(visible).toBe(true);
  });

  test('配置 closeAction 为 quit：关闭主窗口直接退出应用', async ({ launchElectronApp }) => {
    const app = await launchElectronApp();
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // 切换设置 closeAction 为 quit
    await page.evaluate(async () => {
      await (window as any).pidesktop.hostInvoke({
        id: 'test-set',
        module: 'settings',
        action: 'set',
        payload: { key: 'closeAction', value: 'quit' },
      });
    });

    // 点击关闭按钮触发 close
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].close();
    });

    // 进程应该退出
    await app.waitForEvent('close', { timeout: 10_000 });
  });

  test('退出流程不被 close 拦截卡住（before-quit 放行）', async ({ launchElectronApp }) => {
    const app = await launchElectronApp();
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // app.quit() 走 before-quit → setQuitting(true) → 主窗口 close 放行 → 应用退出。
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await app.waitForEvent('close', { timeout: 10_000 });
  });
});
