import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import type { PiSessionRow } from '@shared/host-api/contract';
import { hostApi } from '../lib/host-api';
import { onHostEvent } from '../lib/host-events';
import { useChatStore } from '../stores/chat';

type ProjectGroup = {
  cwd: string;
  name: string;
  sessions: PiSessionRow[];
  latest: string;
};

function groupByProject(sessions: PiSessionRow[]): ProjectGroup[] {
  const map = new Map<string, PiSessionRow[]>();
  for (const s of sessions) {
    const key = s.cwd || '(unknown)';
    map.set(key, [...(map.get(key) ?? []), s]);
  }
  return [...map.entries()]
    .map(([cwd, rows]) => ({
      cwd,
      name: cwd.split('/').filter(Boolean).pop() ?? cwd,
      sessions: rows,
      latest: rows[0]?.modified ?? '',
    }))
    .sort((a, b) => b.latest.localeCompare(a.latest));
}

/** 侧栏会话列表：按项目（cwd）分组折叠，Codex 式。 */
export function SessionList() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<PiSessionRow[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const started = useChatStore((s) => s.started);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const activeCwd = useChatStore((s) => s.cwd);

  const refresh = () => {
    void hostApi.piSessions
      .listAll()
      .then((r) => setSessions(r.sessions))
      .catch(() => {});
  };

  useEffect(() => {
    if (started) refresh();
    const unbind = onHostEvent('piRuntime', 'sessionReplaced', refresh);
    return unbind;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  // 一轮对话结束后刷新（消息数/修改时间变化）
  useEffect(() => {
    if (!isStreaming && started) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  const groups = useMemo(() => groupByProject(sessions), [sessions]);

  if (!started || groups.length === 0) return null;

  return (
    <div className="sidebar-sessions" data-testid="sidebar-sessions">
      {groups.map((group) => {
        // 当前项目默认展开；其他项目默认折叠（用户手动展开后记住状态）
        const isCollapsed = collapsed[group.cwd] ?? group.cwd !== activeCwd;
        return (
          <div key={group.cwd} className="session-group" data-testid={`session-group-${group.name}`}>
            <button
              className="session-group-header"
              data-testid={`session-group-header-${group.name}`}
              title={group.cwd}
              onClick={() =>
                setCollapsed((prev) => ({ ...prev, [group.cwd]: !isCollapsed }))
              }
            >
              {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              <Folder size={13} />
              <span className="session-group-name">{group.name}</span>
              <span className="session-group-count">{group.sessions.length}</span>
            </button>
            {!isCollapsed &&
              group.sessions.slice(0, 10).map((s) => (
                <button
                  key={s.id}
                  data-testid={`sidebar-session-${s.id}`}
                  className={s.isCurrent ? 'sidebar-session current' : 'sidebar-session'}
                  title={s.path}
                  onClick={() => {
                    if (!s.isCurrent) void hostApi.piSessions.switch(s.path, s.cwd);
                  }}
                >
                  <span className="sidebar-session-title">
                    {s.name || s.firstMessage || t('sessions.untitled')}
                  </span>
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}
