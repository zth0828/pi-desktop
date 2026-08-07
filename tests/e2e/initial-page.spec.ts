import path from 'node:path';
import { expect, test } from './fixtures/electron';

test('非 npm pi 的 dev override 可直接进入 Packages 页面', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({
    initialPage: 'packages',
    devPiPackageRoot: path.join(
      process.cwd(),
      'node_modules/@earendil-works/pi-coding-agent',
    ),
  });
  const page = await app.firstWindow();

  await expect(page.getByTestId('nav-extensions')).toHaveClass(/active/);
  await expect(page.getByRole('heading', { name: 'Packages' })).toBeVisible();
});
