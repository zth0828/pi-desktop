import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PiSessionRow } from '@shared/host-api/contract';
import { hostApi } from '../lib/host-api';
import { onHostEvent } from '../lib/host-events';
import { useChatStore } from '../stores/chat';

/** 侧栏会话列表（当前 workspace，modified 倒序前 20 条）。 */
export function SessionList() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<PiSessionRow[]>([]);
  const started = useChatStore((s) => s.started);
  const isStreaming = useChatStore((s) => s.isStreaming);

  const refresh = () => {
    void hostApi.piSessions
      .list()
      .then((r) => setSessions(r.sessions.slice(0, 20)))
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

  if (!started || sessions.length === 0) return null;

  return (
    <div className="sidebar-sessions" data-testid="sidebar-sessions">
      {sessions.map((s) => (
        <button
          key={s.id}
          data-testid={`sidebar-session-${s.id}`}
          className={s.isCurrent ? 'sidebar-session current' : 'sidebar-session'}
          title={s.path}
          onClick={() => {
            if (!s.isCurrent) void hostApi.piSessions.switch(s.path);
          }}
        >
          <span className="sidebar-session-title">
            {s.name || s.firstMessage || t('sessions.untitled')}
          </span>
        </button>
      ))}
    </div>
  );
}
