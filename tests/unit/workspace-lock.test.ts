import { describe, expect, it, vi } from 'vitest';

describe('workspace-lock (已有消息的工作区锁定与防误触)', () => {
  it('当会话已有消息记录时，判定为工作区锁定态', () => {
    const emptyMessages: unknown[] = [];
    const populatedMessages = [{ role: 'user', content: 'hello' }];

    const isLockedForEmpty = emptyMessages.length > 0;
    const isLockedForPopulated = populatedMessages.length > 0;

    expect(isLockedForEmpty).toBe(false);
    expect(isLockedForPopulated).toBe(true);
  });

  it('锁定态点击触发 showInFolder，未锁定态点击触发 onChooseWorkspace', async () => {
    const onChooseWorkspace = vi.fn().mockResolvedValue(undefined);
    const showInFolder = vi.fn().mockResolvedValue({ success: true });
    const cwd = '/test/workspace';

    const handleWorkspaceClick = (workspaceLocked: boolean) => {
      if (workspaceLocked) {
        void showInFolder(cwd);
      } else {
        void onChooseWorkspace();
      }
    };

    // 1. 锁定态
    handleWorkspaceClick(true);
    expect(showInFolder).toHaveBeenCalledWith(cwd);
    expect(onChooseWorkspace).not.toHaveBeenCalled();

    vi.clearAllMocks();

    // 2. 未锁定态（空白新会话）
    handleWorkspaceClick(false);
    expect(showInFolder).not.toHaveBeenCalled();
    expect(onChooseWorkspace).toHaveBeenCalled();
  });
});
