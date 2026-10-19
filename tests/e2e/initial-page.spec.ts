import { expect, test } from './fixtures/electron';
import { piTestEnv } from '../helpers/pi-prefix';

test('非 npm pi 的 dev override 可直接进入 Packages 页面', async ({ launchElectronApp }) => {
  const { piPackageRoot } = piTestEnv();
  const app = await launchElectronApp({
    initialPage: 'packages',
    devPiPackageRoot: piPackageRoot,
  });
  const page = await app.firstWindow();

  await expect(page.getByTestId('nav-extensions')).toHaveClass(/active/);
  await expect(page.getByRole('heading', { name: 'Packages' })).toBeVisible();
});
