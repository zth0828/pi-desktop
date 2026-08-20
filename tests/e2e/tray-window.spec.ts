// 主窗口关闭行为 E2E：Windows/Linux 关闭主窗口 → 隐藏到托盘继续运行（不退出），
// 可恢复；真正退出走 app.quit()（fixture 收尾每次都走该路径，被拦截会卡住所有测试，
// 因此退出放行是隐式覆盖）。macOS 保持关闭即销毁 + dock 重建惯例，用例跳过。
import { expect, test } from './fixtures/electron';

test.describe('主窗口关闭行为', () => {
  test('关闭主窗口 → 隐藏不退出，可恢复（Windows/Linux 托盘模式）', async ({ launchElectronApp }) => {
    test.skip(process.platform === 'darwin', 'macOS 保持关闭即销毁 + dock activate 重建');
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

    // 恢复（托盘点击路径）：show + focus 后窗口可见
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

  test('退出流程不被 close 拦截卡住（before-quit 放行）', async ({ launchElectronApp }) => {
    test.skip(process.platform === 'darwin', 'macOS 无 close 拦截');
    const app = await launchElectronApp();
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // app.quit() 走 before-quit → setQuitting(true) → 主窗口 close 放行 → 应用退出。
    // evaluate 的 promise 在退出前 resolve；随后进程应退出（fixture 收尾会等待）。
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await app.waitForEvent('close', { timeout: 10_000 });
  });
});
