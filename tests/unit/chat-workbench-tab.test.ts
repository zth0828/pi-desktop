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

  it('openWorkspaceFile 正确规范化跨平台工作区绝对路径并转换为相对路径', () => {
    const store = createChatStore();
    store.setState({ cwd: 'C:\\repo\\project' });

    // Windows 反斜杠与大小写不敏感驱动器
    store.getState().openWorkspaceFile('c:/repo/project/src/index.ts');
    expect(store.getState().workspaceOpen).toBe(true);
    expect(store.getState().reviewOpen).toBe(false);
    expect(store.getState().workspaceFileRequest).toEqual({
      path: 'src/index.ts',
      nonce: 1,
    });

    // Windows 扩展前缀 (\\?\)
    store.getState().openWorkspaceFile('\\\\?\\C:\\repo\\project\\src\\app.tsx');
    expect(store.getState().workspaceFileRequest).toEqual({
      path: 'src/app.tsx',
      nonce: 2,
    });

    // 外部绝对路径保持原样
    store.getState().openWorkspaceFile('D:\\other\\secret.txt');
    expect(store.getState().workspaceFileRequest).toEqual({
      path: 'D:/other/secret.txt',
      nonce: 3,
    });
  });

  it('openWorkspaceFile 忽略空字符串、纯空白或非字符串输入', () => {
    const store = createChatStore();
    expect(store.getState().workspaceFileRequest).toBeNull();

    store.getState().openWorkspaceFile('');
    expect(store.getState().workspaceFileRequest).toBeNull();

    store.getState().openWorkspaceFile('   ');
    expect(store.getState().workspaceFileRequest).toBeNull();

    store.getState().openWorkspaceFile(null as any);
    expect(store.getState().workspaceFileRequest).toBeNull();
  });

  it('openReviewFile 处理空白字符或未提供路径时打开审阅面板且 path 为 undefined', () => {
    const store = createChatStore();
    store.getState().openReviewFile('   ');
    expect(store.getState().reviewOpen).toBe(true);
    expect(store.getState().reviewFileRequest).toEqual({
      path: undefined,
      nonce: 1,
    });
  });

  it('applyState 容忍 null 或缺失 messages/historyMessages 的异常状态对象', () => {
    const store = createChatStore();
    expect(() => store.getState().applyState(null as any)).not.toThrow();
    expect(() =>
      store.getState().applyState({
        cwd: '/repo',
        sessionId: 's-1',
        generation: 1,
      } as any),
    ).not.toThrow();
    expect(store.getState().messages).toEqual([]);
    expect(store.getState().historyMessages).toEqual([]);
  });
});
