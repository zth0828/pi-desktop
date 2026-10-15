import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostRequest } from '@shared/host-api/types';
import { createChatStore, type ChatStore } from '@/stores/chat';

describe('用户消息编辑 [ ✏️ ] 与时光倒流核心逻辑 (user-message-edit)', () => {
  let invokedActions: Array<{ module: string; action: string; payload: unknown }> = [];

  function installBridge(options?: {
    editorText?: string;
    backendTurnFiles?: Array<{ path: string; status: 'modified' | 'added' | 'deleted'; added: number; deleted: number }>;
  }) {
    invokedActions = [];
    (globalThis as { window?: unknown }).window = {
      pidesktop: {
        hostInvoke: vi.fn(async (request: HostRequest) => {
          invokedActions.push({ module: request.module, action: request.action, payload: request.payload });
          if (request.module === 'piRuntime' && request.action === 'navigateTree') {
            return {
              id: request.id,
              ok: true,
              data: { success: true, editorText: options?.editorText ?? 'restored prompt text' },
            };
          }
          if (request.module === 'review' && request.action === 'getTurnChanges') {
            return {
              id: request.id,
              ok: true,
              data: {
                available: true,
                files: options?.backendTurnFiles ?? [],
              },
            };
          }
          if (request.module === 'review' && request.action === 'revertToTurnCheckpoint') {
            return {
              id: request.id,
              ok: true,
              data: { success: true, revertedFiles: ['src/app.ts'] },
            };
          }
          if (request.module === 'review' && request.action === 'revertFile') {
            return {
              id: request.id,
              ok: true,
              data: { success: true },
            };
          }
          return { id: request.id, ok: true, data: { success: true } };
        }),
      },
    };
  }

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('场景 A：无代码变动轮次点击铅笔，零弹窗直达回填输入框并退回对话', async () => {
    installBridge({ editorText: 'pure question prompt' });
    const store: ChatStore = createChatStore();
    store.setState({
      boundSessionId: 'session-1',
      running: false,
      isStreaming: false,
      messages: [
        {
          role: 'user',
          entryId: 'user-entry-1',
          content: [{ type: 'text', text: 'pure question prompt' }],
          timestamp: 1000,
          raw: { role: 'user', content: [{ type: 'text', text: 'pure question prompt' }] },
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'pure text answer' }],
          timestamp: 2000,
          raw: { role: 'assistant', content: [{ type: 'text', text: 'pure text answer' }] },
        },
      ],
    });

    await store.getState().editMessage('user-entry-1');

    // 零弹窗打开
    expect(store.getState().confirmUndoDialog).toBeNull();
    // 直接触发 navigateTree，而不是 fork
    expect(invokedActions.some((a) => a.module === 'piRuntime' && a.action === 'navigateTree')).toBe(true);
    expect(invokedActions.some((a) => a.module === 'piRuntime' && a.action === 'fork')).toBe(false);
    // 输入框回填
    expect(store.getState().inputDraft?.text).toBe('pure question prompt');
  });

  it('场景 B：发生代码修改的轮次点击铅笔，调起安全确认弹窗并列出改动文件', async () => {
    installBridge();
    const store: ChatStore = createChatStore();
    store.setState({
      boundSessionId: 'session-1',
      running: false,
      isStreaming: false,
      messages: [
        {
          role: 'user',
          entryId: 'user-entry-edit',
          content: [{ type: 'text', text: 'fix this code' }],
          timestamp: 1000,
          raw: { role: 'user', content: [{ type: 'text', text: 'fix this code' }] },
        },
        {
          role: 'assistant',
          content: [
            { type: 'toolCall', id: 'call-1', name: 'edit', args: { path: 'src/main.ts' } },
          ],
          timestamp: 2000,
          raw: { role: 'assistant', content: [] },
        },
      ],
      toolExecutions: {
        'call-1': {
          toolCallId: 'call-1',
          toolName: 'edit',
          args: { path: 'src/main.ts' },
          status: 'success',
          result: { details: { diff: '--- src/main.ts\n+++ src/main.ts\n@@ -1,1 +1,2 @@\n-old\n+new\n+added' } },
        },
      },
    });

    await store.getState().editMessage('user-entry-edit');

    // 弹窗被调起
    const dialog = store.getState().confirmUndoDialog;
    expect(dialog).not.toBeNull();
    expect(dialog?.open).toBe(true);
    expect(dialog?.entryId).toBe('user-entry-edit');
    expect(dialog?.files.length).toBe(1);
    expect(dialog?.files[0].path).toBe('src/main.ts');
    expect(dialog?.files[0].action).toBe('revert');

    // 用户确认全量撤销（还原文件 + 退回对话）
    await store.getState().executeConfirmUndo({ revertFiles: true, rewindConversation: true });

    // 执行了影子快照还原与 navigateTree
    expect(invokedActions.some((a) => a.module === 'review' && a.action === 'revertToTurnCheckpoint')).toBe(true);
    expect(invokedActions.some((a) => a.module === 'piRuntime' && a.action === 'navigateTree')).toBe(true);
    expect(store.getState().confirmUndoDialog).toBeNull();
  });

  it('场景 C：跨轮次回溯标记 isHistoricalTurn 并聚合后续全部轮次的文件变更', async () => {
    installBridge();
    const store: ChatStore = createChatStore();
    store.setState({
      boundSessionId: 'session-1',
      running: false,
      isStreaming: false,
      messages: [
        // Turn 0
        {
          role: 'user',
          entryId: 'entry-turn-0',
          content: [{ type: 'text', text: 'turn 0 question' }],
          timestamp: 1000,
          raw: { role: 'user', content: [{ type: 'text', text: 'turn 0 question' }] },
        },
        {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'call-turn-0', name: 'write', args: { path: 'file0.ts', content: 'hello' } }],
          timestamp: 2000,
          raw: { role: 'assistant', content: [] },
        },
        // Turn 1
        {
          role: 'user',
          entryId: 'entry-turn-1',
          content: [{ type: 'text', text: 'turn 1 question' }],
          timestamp: 3000,
          raw: { role: 'user', content: [{ type: 'text', text: 'turn 1 question' }] },
        },
        {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'call-turn-1', name: 'edit', args: { path: 'file1.ts' } }],
          timestamp: 4000,
          raw: { role: 'assistant', content: [] },
        },
      ],
      toolExecutions: {
        'call-turn-0': {
          toolCallId: 'call-turn-0',
          toolName: 'write',
          args: { path: 'file0.ts', content: 'hello' },
          status: 'success',
        },
        'call-turn-1': {
          toolCallId: 'call-turn-1',
          toolName: 'edit',
          args: { path: 'file1.ts' },
          status: 'success',
          result: { details: { diff: '--- file1.ts\n+++ file1.ts\n@@ -1 +1 @@\n-a\n+b' } },
        },
      },
    });

    // 从过去的第一轮（Turn 0）点击编辑
    await store.getState().editMessage('entry-turn-0');

    const dialog = store.getState().confirmUndoDialog;
    expect(dialog).not.toBeNull();
    expect(dialog?.targetTurnIndex).toBe(0);
    expect(dialog?.isHistoricalTurn).toBe(true);
    // 聚合了 Turn 0 与 Turn 1 的两个文件
    const filePaths = dialog?.files.map((f) => f.path);
    expect(filePaths).toContain('file0.ts');
    expect(filePaths).toContain('file1.ts');
  });

  it('场景 D：用户选择仅回退对话（保留代码修改），不触碰磁盘文件', async () => {
    installBridge();
    const store: ChatStore = createChatStore();
    store.setState({
      boundSessionId: 'session-1',
      confirmUndoDialog: {
        open: true,
        entryId: 'user-entry-1',
        targetTurnIndex: 0,
        isHistoricalTurn: false,
        files: [{ path: 'file.ts', action: 'revert' }],
      },
    });

    // 用户选择仅回退对话
    await store.getState().executeConfirmUndo({ revertFiles: false, rewindConversation: true });

    // 未调用任何 revert 动作
    expect(invokedActions.some((a) => a.module === 'review' && a.action === 'revertToTurnCheckpoint')).toBe(false);
    expect(invokedActions.some((a) => a.module === 'review' && a.action === 'revertFile')).toBe(false);
    // 依然回退了对话树
    expect(invokedActions.some((a) => a.module === 'piRuntime' && a.action === 'navigateTree')).toBe(true);
    expect(store.getState().confirmUndoDialog).toBeNull();
  });
});
