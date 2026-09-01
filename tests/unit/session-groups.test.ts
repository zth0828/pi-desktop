import { describe, expect, it } from 'vitest';
import type { PiSessionRow } from '@shared/host-api/contract';
import { getProjectName, groupByProject } from '../../src/lib/session-groups';

function mockSession(overrides: Partial<PiSessionRow>): PiSessionRow {
  return {
    path: '/path/to/session.jsonl',
    id: 'test-id',
    cwd: '/Users/test/project',
    firstMessage: 'Hello',
    messageCount: 1,
    created: '2026-08-26T10:00:00.000Z',
    modified: '2026-08-26T10:00:00.000Z',
    isCurrent: false,
    isRunning: false,
    archived: false,
    pinned: false,
    ...overrides,
  };
}

describe('getProjectName', () => {
  it('正确提取 Unix / macOS 路径的末级项目名', () => {
    expect(getProjectName('/Users/test/work/project-alpha')).toBe('project-alpha');
    expect(getProjectName('/Users/test/work/project-alpha/')).toBe('project-alpha');
  });

  it('正确提取 Windows 路径的末级项目名', () => {
    expect(getProjectName('C:\\Users\\test\\work\\project-beta')).toBe('project-beta');
    expect(getProjectName('C:\\Users\\test\\work\\project-beta\\')).toBe('project-beta');
  });

  it('空路径或兜底情况安全处理', () => {
    expect(getProjectName('')).toBe('');
    expect(getProjectName(undefined)).toBe('');
  });
});

describe('groupByProject', () => {
  it('按项目分组并按组内最新修改时间倒序排列', () => {
    const sessions: PiSessionRow[] = [
      mockSession({ cwd: '/workspace/project-a', messageCount: 2, modified: '2026-08-26T08:00:00.000Z' }),
      mockSession({ cwd: '/workspace/project-b', messageCount: 5, modified: '2026-08-26T09:00:00.000Z' }),
      mockSession({ cwd: '/workspace/project-a', messageCount: 1, modified: '2026-08-26T10:00:00.000Z' }),
    ];
    const groups = groupByProject(sessions);
    expect(groups).toHaveLength(2);
    expect(groups[0].name).toBe('project-a');
    expect(groups[0].sessions).toHaveLength(2);
    expect(groups[1].name).toBe('project-b');
    expect(groups[1].sessions).toHaveLength(1);
  });

  it('置顶会话（pinned: true）在项目组内优先排在前面', () => {
    const sessions: PiSessionRow[] = [
      mockSession({ id: 's1', cwd: '/workspace/project-a', messageCount: 2, modified: '2026-08-26T12:00:00.000Z', pinned: false }),
      mockSession({ id: 's2', cwd: '/workspace/project-a', messageCount: 1, modified: '2026-08-26T10:00:00.000Z', pinned: true }),
      mockSession({ id: 's3', cwd: '/workspace/project-a', messageCount: 3, modified: '2026-08-26T11:00:00.000Z', pinned: true }),
    ];
    const groups = groupByProject(sessions);
    expect(groups).toHaveLength(1);
    const resultIds = groups[0].sessions.map((s) => s.id);
    // s3 和 s2 都置顶，s3 较新排第一，s2 置顶排第二，s1 未置顶排第三
    expect(resultIds).toEqual(['s3', 's2', 's1']);
  });

  it('自动过滤 messageCount <= 0 的未发送空会话', () => {
    const sessions: PiSessionRow[] = [
      mockSession({ cwd: '/workspace/project-a', messageCount: 0, firstMessage: '' }),
      mockSession({ cwd: '/workspace/project-a', messageCount: 3, firstMessage: 'valid' }),
      mockSession({ cwd: '/workspace/project-b', messageCount: 0, firstMessage: '' }),
    ];
    const groups = groupByProject(sessions);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('project-a');
    expect(groups[0].sessions).toHaveLength(1);
    expect(groups[0].sessions[0].firstMessage).toBe('valid');
  });

  it('全部为 0 消息会话时返回空数组', () => {
    const sessions: PiSessionRow[] = [
      mockSession({ cwd: '/workspace/project-a', messageCount: 0 }),
      mockSession({ cwd: '/workspace/project-b', messageCount: 0 }),
    ];
    const groups = groupByProject(sessions);
    expect(groups).toHaveLength(0);
  });
});
