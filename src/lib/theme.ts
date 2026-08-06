// 主题应用：light/dark/system → <html data-theme>。system 时跟随 OS。
import { hostApi } from './host-api';

export type Theme = 'light' | 'dark' | 'system';

export function applyTheme(theme: Theme): void {
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

export async function initTheme(): Promise<void> {
  const saved = await hostApi.settings.get('theme').catch(() => undefined);
  applyTheme((saved as Theme | undefined) ?? 'system');
}

export async function setTheme(theme: Theme): Promise<void> {
  applyTheme(theme);
  await hostApi.settings.set('theme', theme);
}
