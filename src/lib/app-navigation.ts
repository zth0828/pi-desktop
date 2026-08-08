// 渲染层内页面导航的轻量通道：页面状态在 App.tsx 的 useState 里，
// 深层组件（如 ChatInput 的 /settings /login /resume 斜杠命令）经这里请求切页。
import type { AppPageId } from '@shared/app-page';

type NavigateListener = (page: AppPageId) => void;
const listeners = new Set<NavigateListener>();

export function navigateToPage(page: AppPageId): void {
  for (const listener of listeners) listener(page);
}

export function onNavigateToPage(listener: NavigateListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
