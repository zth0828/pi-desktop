import path from 'node:path';
import { expect, test } from './fixtures/electron';

test('loads the branded application icon', async ({ electronApp }) => {
  const title = await electronApp.evaluate(({ BrowserWindow }) => (
    BrowserWindow.getAllWindows()[0]?.getTitle()
  ));
  expect(title).toBe('Pi Desktop');

  const iconPath = path.join(process.cwd(), 'resources/icon.png');
  const icon = await electronApp.evaluate(({ nativeImage }, source) => {
    const image = nativeImage.createFromPath(source);
    return { isEmpty: image.isEmpty(), size: image.getSize() };
  }, iconPath);
  expect(icon).toEqual({ isEmpty: false, size: { width: 1024, height: 1024 } });
});
