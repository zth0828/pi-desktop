export const APP_PAGE_IDS = [
  'chat',
  'models',
  'sessions',
  'skills',
  'extensions',
  'mcp',
  'settings',
] as const;

export type AppPageId = (typeof APP_PAGE_IDS)[number];

/** CLI 对用户称 Packages，应用内部沿用 extensions 页面 id。 */
export function resolveAppPageId(value: string | null | undefined): AppPageId | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'packages') return 'extensions';
  return APP_PAGE_IDS.find((page) => page === normalized);
}

export function initialAppPage(search: string): AppPageId {
  return resolveAppPageId(new URLSearchParams(search).get('page')) ?? 'chat';
}
