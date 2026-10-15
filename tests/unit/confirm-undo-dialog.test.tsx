import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmUndoDialog, type ConfirmUndoFile } from '../../src/pages/Chat/ConfirmUndoDialog';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('react', async () => {
  const actual = await vi.importActual<any>('react');
  return {
    ...actual,
    useState: (init: any) => [init, vi.fn()],
    useEffect: () => {},
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        'chat.confirmUndo.title': '确认撤销',
        'chat.confirmUndo.historicalTitle': '确认时光倒流',
        'chat.confirmUndo.description': '确认此撤销操作将执行以下变更：',
        'chat.confirmUndo.historicalDescription': '您正在回退至第 2 轮发问，检测到该轮及后续产生了代码修改：',
        'chat.confirmUndo.revertModifiedFiles': '恢复物理文件改动',
        'chat.confirmUndo.revertFilesHint': '还原磁盘上的物理文件改动',
        'chat.confirmUndo.rewindConversation': '同时将对话历史退回至发问前',
        'chat.confirmUndo.rewindConversationHint': '放弃本轮模型答复，分支退回发问前',
        'chat.confirmUndo.gitProtectionNotice': '🛡️ Git 保护：仅还原工作区未提交文件，绝不产生 git revert 提交或修改 commit 历史。',
        'chat.confirmUndo.actionDelete': '删除',
        'chat.confirmUndo.actionRevert': '还原',
        'chat.confirmUndo.actionRestore': '恢复',
        'chat.confirmUndo.cancel': '取消',
        'chat.confirmUndo.confirm': '确认撤销',
        'chat.confirmUndo.onlyFiles': '仅撤销文件',
        'chat.confirmUndo.onlyConversation': '仅回退对话',
        'chat.confirmUndo.fullUndo': '彻底回退本轮',
        'common.close': '关闭',
      };
      return dict[key] ?? key;
    },
  }),
}));

const mockFiles: ConfirmUndoFile[] = [
  { path: 'src/app.ts', action: 'revert' },
  { path: 'src/new-feature.ts', action: 'delete' },
];

describe('ConfirmUndoDialog UI rendering', () => {
  it('closed state returns null', () => {
    const html = renderToStaticMarkup(
      <ConfirmUndoDialog
        open={false}
        files={mockFiles}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(html).toBe('');
  });

  it('renders all sections, files, and buttons when open', () => {
    const html = renderToStaticMarkup(
      <ConfirmUndoDialog
        open={true}
        files={mockFiles}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(html).toContain('confirm-undo-dialog');
    expect(html).toContain('确认撤销');
    expect(html).toContain('恢复物理文件改动');
    expect(html).toContain('同时将对话历史退回至发问前');
    expect(html).toContain('🛡️ Git 保护：仅还原工作区未提交文件');
    expect(html).toContain('src/app.ts');
    expect(html).toContain('src/new-feature.ts');
    expect(html).toContain('data-testid="confirm-undo-cancel"');
    expect(html).toContain('data-testid="confirm-undo-files-only"');
    expect(html).toContain('data-testid="confirm-undo-conversation-only"');
    expect(html).toContain('data-testid="confirm-undo-full"');
  });

  it('renders historical turn title and description when isHistoricalTurn is true', () => {
    const html = renderToStaticMarkup(
      <ConfirmUndoDialog
        open={true}
        files={mockFiles}
        targetTurnIndex={1}
        isHistoricalTurn={true}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(html).toContain('确认时光倒流');
    expect(html).toContain('您正在回退至第 2 轮发问');
  });
});

describe('ConfirmUndoDialog interaction callbacks', () => {
  it('click buttons trigger onConfirm with corresponding options', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    const element = ConfirmUndoDialog({
      open: true,
      files: mockFiles,
      onConfirm,
      onClose,
    });

    expect(element).not.toBeNull();
    // Verify children elements and button clicks
    const dialog = element!.props.children;
    const footer = dialog.props.children[2];
    const [cancelBtn, filesOnlyBtn, convOnlyBtn, fullBtn] = footer.props.children;

    // 1. Cancel button
    cancelBtn.props.onClick();
    expect(onClose).toHaveBeenCalledTimes(1);

    // 2. Only files button
    filesOnlyBtn.props.onClick();
    expect(onConfirm).toHaveBeenLastCalledWith({
      revertFiles: true,
      rewindConversation: false,
    });

    // 3. Only conversation button
    convOnlyBtn.props.onClick();
    expect(onConfirm).toHaveBeenLastCalledWith({
      revertFiles: false,
      rewindConversation: true,
    });

    // 4. Full undo button
    fullBtn.props.onClick();
    expect(onConfirm).toHaveBeenLastCalledWith({
      revertFiles: true,
      rewindConversation: true,
    });
  });
});
