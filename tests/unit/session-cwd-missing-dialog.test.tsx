import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

let mockStoreState = {
  sessionCwdMissing: null as { sessionPath: string; sessionCwd: string; fallbackCwd: string; sessionCount?: number; detectedCwd?: string } | null,
  switchSession: vi.fn(),
  dismissSessionCwdMissing: vi.fn(),
};

vi.mock('../../src/pages/Chat/chat-store-context', () => ({
  usePaneChatStore: (selector: (s: typeof mockStoreState) => unknown) => selector(mockStoreState),
}));

const relocateProjectMock = vi.fn().mockResolvedValue({ success: true });
const openDirectoryMock = vi.fn();

vi.mock('../../src/lib/host-api', () => ({
  hostApi: {
    piSessions: {
      relocateProject: (...args: unknown[]) => relocateProjectMock(...args),
    },
    dialog: {
      openDirectory: (...args: unknown[]) => openDirectoryMock(...args),
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (key === 'chat.sessionCwdMissing.applyToAll') {
        return `同时迁移该原目录下的全部 ${options?.count} 个历史会话`;
      }
      return key;
    },
  }),
}));

const { SessionCwdMissingDialog } = await import('../../src/pages/Chat/SessionCwdMissingDialog');

describe('SessionCwdMissingDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sessionCwdMissing 为 null 时不渲染任何内容', () => {
    mockStoreState.sessionCwdMissing = null;
    const html = renderToStaticMarkup(<SessionCwdMissingDialog />);
    expect(html).toBe('');
  });

  it('单条会话时不渲染批量迁移勾选框', () => {
    mockStoreState.sessionCwdMissing = {
      sessionPath: '/fake/session.jsonl',
      sessionCwd: '/fake/old-project',
      fallbackCwd: '/fake/new-project',
      sessionCount: 1,
    };
    const html = renderToStaticMarkup(<SessionCwdMissingDialog />);
    expect(html).toContain('data-testid="session-cwd-missing-dialog"');
    expect(html).not.toContain('session-cwd-missing-batch-checkbox');
  });

  it('关联会话数 > 1 时渲染批量迁移勾选框并展示正确数量', () => {
    mockStoreState.sessionCwdMissing = {
      sessionPath: '/fake/session.jsonl',
      sessionCwd: '/fake/old-project',
      fallbackCwd: '/fake/new-project',
      sessionCount: 24,
    };
    const html = renderToStaticMarkup(<SessionCwdMissingDialog />);
    expect(html).toContain('session-cwd-missing-batch-checkbox');
    expect(html).toContain('同时迁移该原目录下的全部 24 个历史会话');
  });

  it('存在智能匹配目录 detectedCwd 时渲染推荐目录行与一键迁移按钮，且不展示不一致警示', () => {
    mockStoreState.sessionCwdMissing = {
      sessionPath: '/fake/session.jsonl',
      sessionCwd: '/fake/Desktop/pi-desktop',
      fallbackCwd: '/fake/Desktop/bingking_project/FlowGate',
      detectedCwd: '/fake/Desktop/bingking_project/pi-desktop',
      sessionCount: 72,
    };
    const html = renderToStaticMarkup(<SessionCwdMissingDialog />);
    expect(html).toContain('data-testid="session-cwd-missing-detected-box"');
    expect(html).toContain('/fake/Desktop/bingking_project/pi-desktop');
    expect(html).toContain('data-testid="session-cwd-missing-apply-detected"');
    expect(html).toContain('data-testid="session-cwd-missing-choose"');
    expect(html).not.toContain('data-testid="session-cwd-mismatch-warning"');
    expect(html).not.toContain('data-testid="session-cwd-missing-confirm"');
  });

  it('未探测到匹配目录且与当前窗口项目名称不一致时展示不匹配警示与当前工作区按钮', () => {
    mockStoreState.sessionCwdMissing = {
      sessionPath: '/fake/session.jsonl',
      sessionCwd: '/fake/Desktop/pi-desktop',
      fallbackCwd: '/fake/Desktop/bingking_project/FlowGate',
      sessionCount: 72,
    };
    const html = renderToStaticMarkup(<SessionCwdMissingDialog />);
    expect(html).toContain('data-testid="session-cwd-mismatch-warning"');
    expect(html).toContain('data-testid="session-cwd-missing-confirm"');
    expect(html).not.toContain('data-testid="session-cwd-missing-apply-detected"');
  });
});
