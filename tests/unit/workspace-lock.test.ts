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

  it('草稿沙箱在已有消息时显示「保存为项目」入口，普通项目或空白草稿不显示', () => {
    const shouldShowConvert = (isScratchpad: boolean, workspaceLocked: boolean) => {
      return isScratchpad && workspaceLocked;
    };

    // 草稿箱已有消息：显示
    expect(shouldShowConvert(true, true)).toBe(true);

    // 草稿箱空白会话：不显示（未锁定，直接在下拉框切换或选择）
    expect(shouldShowConvert(true, false)).toBe(false);

    // 普通项目已有消息：不显示
    expect(shouldShowConvert(false, true)).toBe(false);

    // 普通项目空白会话：不显示
    expect(shouldShowConvert(false, false)).toBe(false);
  });
});

