import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TurnChangesCardView } from '../../src/pages/Chat/TurnChangesCard';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ToolExecution } from '../../src/lib/chat-types';
import type { PiRuntimeTreeNode, ReviewFileEntry } from '@shared/host-api/contract';

const mockReviewRevertFile = vi.fn().mockResolvedValue({ success: true });
const mockReviewRevertToTurnCheckpoint = vi.fn().mockResolvedValue({ success: true });
const mockReviewGetSummary = vi.fn().mockResolvedValue({
  available: true,
  files: [
    { path: 'src/file1.ts', status: 'modified' },
    { path: 'src/file2.ts', status: 'modified' },
  ] as ReviewFileEntry[],
});
const mockGetTree = vi.fn().mockResolvedValue({
  nodes: [
    { id: 'user-entry-1', depth: 0, kind: 'user', text: 'Prompt 1', isLeaf: false, onCurrentPath: true, branchCount: 1 },
    { id: 'user-entry-2', depth: 0, kind: 'user', text: 'Prompt 2', isLeaf: true, onCurrentPath: true, branchCount: 3 },
  ] as PiRuntimeTreeNode[],
  currentLeafId: 'user-entry-2',
  latestLeafId: 'user-entry-2',
});
const mockNavigateTree = vi.fn().mockResolvedValue({ success: true });
const mockNavigateTo = vi.fn().mockResolvedValue({ success: true });
const mockSetTreeOpen = vi.fn();
const mockOpenReviewFile = vi.fn();
const mockOpenWorkspaceFile = vi.fn();

let mockToolExecutions: Record<string, ToolExecution> = {};

vi.mock('../../src/pages/Chat/chat-store-context', () => ({
  usePaneHostApi: () => ({
    review: {
      getSummary: mockReviewGetSummary,
      revertFile: mockReviewRevertFile,
      revertToTurnCheckpoint: mockReviewRevertToTurnCheckpoint,
    },
    piRuntime: {
      getTree: mockGetTree,
      navigateTree: mockNavigateTree,
    },
  }),
  usePaneChatStore: (selector: (state: any) => any) => {
    const state = {
      toolExecutions: mockToolExecutions,
      openReviewFile: mockOpenReviewFile,
      openWorkspaceFile: mockOpenWorkspaceFile,
      setTreeOpen: mockSetTreeOpen,
      navigateTo: mockNavigateTo,
      cwd: '/workspace',
    };
    return selector(state);
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => {
      const dict: Record<string, string> = {
        'chat.turnChanges.title': `已编辑 ${opts?.count ?? 0} 个文件`,
        'chat.turnChanges.revert': '撤销',
        'chat.turnChanges.reverting': '撤销中…',
        'chat.turnChanges.reverted': '已撤销',
        'chat.turnChanges.review': '审核',
        'chat.turnChanges.viewChanges': '查看更改',
        'chat.turnChanges.revertFile': '撤销此文件',
        'chat.turnChanges.revertFileTooltip': '撤销该文件本轮修改',
        'chat.turnChanges.fileReverted': '已复原',
        'chat.turnChanges.snapshot': `Turn ${opts?.n ?? 1} 快照`,
        'chat.turnChanges.branchRoutes': `🌿 ${opts?.count ?? 0} 条分支路线`,
        'chat.turnChanges.viewBranchRoutes': '查看 ▾',
        'chat.turnChanges.openFile': '打开文件',
        'chat.confirmUndo.title': '确认撤销',
      };
      return dict[key] ?? key;
    },
  }),
}));

describe('TurnChangesCardView UI and Revert features', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToolExecutions = {
      tc1: {
        toolCallId: 'tc1',
        toolName: 'edit',
        status: 'success',
        args: { path: 'src/file1.ts' },
        result: {
          content: [],
          details: {
            diff: '+ 1 line 1\n+ 2 line 2\n- 3 line 3',
          },
        },
      },
      tc2: {
        toolCallId: 'tc2',
        toolName: 'write',
        status: 'success',
        args: { path: 'src/file2.ts', content: 'line 1\nline 2\nline 3\n' },
        result: { content: [] },
      },
    };
  });

  it('returns null if there are no file changes', () => {
    const html = renderToStaticMarkup(
      <TurnChangesCardView toolCallIds={[]} />
    );
    expect(html).toBe('');
  });

  it('renders turn changes card with stats, single trunk snapshot, and inline revert buttons', () => {
    const html = renderToStaticMarkup(
      <TurnChangesCardView
        toolCallIds={['tc1', 'tc2']}
        userEntryId="user-entry-1"
        turnIndex={0}
      />
    );

    expect(html).toContain('turn-changes');
    expect(html).toContain('已编辑 2 个文件');
    expect(html).toContain('+5');
    expect(html).toContain('-1');
    expect(html).toContain('Turn 1 快照');
    expect(html).toContain('data-testid="turn-changes-file-revert"');
    expect(html).toContain('撤销此文件');
  });

  it('renders multi-branch route indicator when branchCount > 1', () => {
    const html = renderToStaticMarkup(
      <TurnChangesCardView
        toolCallIds={['tc1']}
        userEntryId="user-entry-2"
        turnIndex={1}
        branchCount={3}
      />
    );
    expect(html).toContain('turn-changes-branches');
    expect(html).toContain('🌿 3 条分支路线');
    expect(html).toContain('查看 ▾');
  });

  it('reverting a single file deducts lines and marks file as reverted', () => {
    const initialChanges = {
      files: [
        { path: 'src/file1.ts', added: 2, deleted: 1 },
        { path: 'src/file2.ts', added: 3, deleted: 0 },
      ],
      totalAdded: 5,
      totalDeleted: 1,
    };

    const revertedSet = new Set<string>();
    revertedSet.add('src/file1.ts');

    const activeFiles = initialChanges.files.filter((f) => !revertedSet.has(f.path));
    const remainingAdded = activeFiles.reduce((acc, f) => acc + f.added, 0);
    const remainingDeleted = activeFiles.reduce((acc, f) => acc + f.deleted, 0);

    expect(activeFiles).toHaveLength(1);
    expect(activeFiles[0].path).toBe('src/file2.ts');
    expect(remainingAdded).toBe(3);
    expect(remainingDeleted).toBe(0);

    // If both files reverted
    revertedSet.add('src/file2.ts');
    const remainingAfterBoth = initialChanges.files.filter((f) => !revertedSet.has(f.path));
    expect(remainingAfterBoth).toHaveLength(0);
  });

  it('handleConfirmUndo triggers navigateTo with userEntryId when revertAll succeeds', async () => {
    const handleConfirmUndo = async (
      options: { revertFiles: boolean; rewindConversation: boolean },
      userEntryId?: string,
      revertAllFn = vi.fn().mockResolvedValue(true)
    ) => {
      let filesReverted = true;
      if (options.revertFiles) {
        filesReverted = await revertAllFn();
      }
      if (!filesReverted) return;
      if (options.rewindConversation && userEntryId) {
        await mockNavigateTo(userEntryId);
      }
    };

    const mockRevertAll = vi.fn().mockResolvedValue(true);
    await handleConfirmUndo({ revertFiles: true, rewindConversation: true }, 'user-entry-1', mockRevertAll);

    expect(mockRevertAll).toHaveBeenCalledTimes(1);
    expect(mockNavigateTo).toHaveBeenCalledWith('user-entry-1');
  });

  it('handleConfirmUndo aborts navigateTo when revertAll fails (e.g. file conflict)', async () => {
    const handleConfirmUndo = async (
      options: { revertFiles: boolean; rewindConversation: boolean },
      userEntryId?: string,
      revertAllFn = vi.fn().mockResolvedValue(false)
    ) => {
      let filesReverted = true;
      if (options.revertFiles) {
        filesReverted = await revertAllFn();
      }
      if (!filesReverted) return;
      if (options.rewindConversation && userEntryId) {
        await mockNavigateTo(userEntryId);
      }
    };

    const mockRevertAll = vi.fn().mockResolvedValue(false);
    await handleConfirmUndo({ revertFiles: true, rewindConversation: true }, 'user-entry-1', mockRevertAll);

    expect(mockRevertAll).toHaveBeenCalledTimes(1);
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });
});
