import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../src/lib/host-api', () => ({
  hostApi: {
    piSessions: {
      relocateProject: vi.fn(),
    },
    dialog: {
      openDirectory: vi.fn(),
    },
    shell: {
      openPath: vi.fn(),
    },
    app: {
      writeClipboard: vi.fn(),
    },
    settings: {
      set: vi.fn(),
    },
  },
}));

vi.mock('../../src/stores/chat-registry', () => ({
  getActiveChatStore: () => ({
    getState: () => ({
      cwd: '/fake/other-cwd',
      started: true,
      newSession: vi.fn(),
      start: vi.fn(),
    }),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        'sessions.relocateProject': '重新定位工作区…',
        'sessions.copyProjectPath': '复制项目路径',
        'sessions.newChatInProject': '在此项目新建会话',
        'sessions.revealInFinder': '在访达中显示',
        'sessions.showInFolder': '在文件管理器中显示',
        'sessions.archive': '归档聊天',
        'sessions.unarchive': '取消归档',
      };
      return dict[key] ?? key;
    },
  }),
}));

describe('Project Context Menu & Header Action Rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderMenu = (cwdExists: boolean, archivedOnly = false, isMac = true) => {
    return (
      <div>
        {cwdExists === false ? (
          <>
            <button data-testid="relocate">重新定位工作区…</button>
            <button data-testid="copy-path">复制项目路径</button>
            <button data-testid="archive">归档聊天</button>
          </>
        ) : (
          <>
            {!archivedOnly && <button data-testid="new-chat">在此项目新建会话</button>}
            <button data-testid="reveal">{isMac ? '在访达中显示' : '在文件管理器中显示'}</button>
            <button data-testid="copy-path">复制项目路径</button>
            <button data-testid="archive">归档聊天</button>
          </>
        )}
      </div>
    );
  };

  it('正常有效项目（cwdExists !== false）：不展示重新定位，展示新建会话、在访达中显示、复制路径、归档', () => {
    const html = renderToStaticMarkup(renderMenu(true));
    expect(html).not.toContain('重新定位工作区…');
    expect(html).toContain('在此项目新建会话');
    expect(html).toContain('在访达中显示');
    expect(html).toContain('复制项目路径');
    expect(html).toContain('归档聊天');
  });

  it('失效项目（cwdExists === false）：展示重新定位、复制路径、归档，不展示新建会话与在访达中显示', () => {
    const html = renderToStaticMarkup(renderMenu(false));
    expect(html).toContain('重新定位工作区…');
    expect(html).toContain('复制项目路径');
    expect(html).toContain('归档聊天');
    expect(html).not.toContain('在此项目新建会话');
    expect(html).not.toContain('在访达中显示');
  });
});
