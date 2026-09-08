import { describe, expect, it } from 'vitest';
import { createChatStore } from '../../src/stores/chat';

describe('chat store workbench tab routing', () => {
  it('切换到 commands 工作区标签页正确设置状态并自增 nonce', () => {
    const store = createChatStore();

    expect(store.getState().workspaceOpen).toBe(false);
    expect(store.getState().reviewOpen).toBe(false);
    expect(store.getState().workbenchTabRequest).toBeNull();

    store.getState().openWorkbenchTab('commands');

    expect(store.getState().workspaceOpen).toBe(true);
    expect(store.getState().reviewOpen).toBe(false);
    expect(store.getState().workbenchTabRequest).toEqual({
      tab: 'commands',
      nonce: 1,
    });

    // 连续再次点击同一个标签页，nonce 必须自增以驱动 UI 响应
    store.getState().openWorkbenchTab('commands');
    expect(store.getState().workbenchTabRequest).toEqual({
      tab: 'commands',
      nonce: 2,
    });
  });

  it('切换到 review 标签页时关闭 workspaceOpen 并打开 reviewOpen', () => {
    const store = createChatStore();

    store.getState().openWorkbenchTab('commands');
    expect(store.getState().workspaceOpen).toBe(true);

    store.getState().openWorkbenchTab('review');
    expect(store.getState().workspaceOpen).toBe(false);
    expect(store.getState().reviewOpen).toBe(true);
    expect(store.getState().workbenchTabRequest).toEqual({
      tab: 'review',
      nonce: 2,
    });
  });
});
