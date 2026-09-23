import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Check, ChevronDown, ChevronRight, Copy, CornerDownLeft, Locate, Search, Square, Terminal, X } from 'lucide-react';
import { collectSessionCommands, type CommandFilter, type SessionCommandItem } from '../../../lib/session-commands';
import { usePaneChatStore, usePaneHostApi } from '../chat-store-context';

/** 右侧「命令」面板：本会话全量命令与终端流水线（Agent 工具调用 + 用户命令）。 */
export function CommandList() {
  const { t } = useTranslation();
  const paneApi = usePaneHostApi();
  const bashDraft = usePaneChatStore((s) => s.bashDraft);
  const historyMessages = usePaneChatStore((s) => s.historyMessages);
  const toolExecutions = usePaneChatStore((s) => s.toolExecutions);
  const setComposerText = usePaneChatStore((s) => s.setComposerText);
  const setCommandMode = usePaneChatStore((s) => s.setCommandMode);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<CommandFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(50);

  useEffect(() => {
    setVisibleCount(50);
  }, [filter, searchQuery]);

  const allCommands = useMemo(
    () => collectSessionCommands(toolExecutions, historyMessages, bashDraft),
    [toolExecutions, historyMessages, bashDraft],
  );

  const filteredCommands = useMemo(() => {
    let list = allCommands;
    if (filter === 'failed') {
      list = list.filter((c) => c.status === 'error' || (c.exitCode !== undefined && c.exitCode !== 0));
    } else if (filter === 'agent') {
      list = list.filter((c) => c.source === 'agent');
    } else if (filter === 'user') {
      list = list.filter((c) => c.source === 'user');
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          c.command.toLowerCase().includes(q) ||
          c.summary.toLowerCase().includes(q) ||
          (c.output && c.output.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [allCommands, filter, searchQuery]);

  const failedCount = useMemo(
    () => allCommands.filter((c) => c.status === 'error' || (c.exitCode !== undefined && c.exitCode !== 0)).length,
    [allCommands],
  );

  const handleJumpToChat = (item: SessionCommandItem, e: MouseEvent) => {
    e.stopPropagation();
    if (!item.chatAnchorId) return;
    const el = document.getElementById(item.chatAnchorId);
    if (el) {
      const turnFold = el.closest('.turn-fold');
      if (turnFold && !turnFold.classList.contains('expanded')) {
        const toggleBtn = turnFold.querySelector<HTMLButtonElement>('.turn-fold-toggle');
        toggleBtn?.click();
      }
      setTimeout(() => {
        const target = document.getElementById(item.chatAnchorId!) ?? el;
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('tool-card-highlight');
        setTimeout(() => target.classList.remove('tool-card-highlight'), 2000);
      }, 60);
    }
  };

  const handleFillComposer = (item: SessionCommandItem, e: MouseEvent) => {
    e.stopPropagation();
    setCommandMode(true);
    setComposerText(item.command);
  };

  const handleCopy = (text: string, key: string, e: MouseEvent) => {
    e.stopPropagation();
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
      setCopiedId(key);
      setTimeout(() => setCopiedId((curr) => (curr === key ? null : curr)), 1500);
    }
  };

  if (allCommands.length === 0) {
    return (
      <div className="command-list workspace-empty" data-testid="command-list">
        {t('workspace.commandsEmpty')}
      </div>
    );
  }

  return (
    <div className="command-panel-container" data-testid="command-list">
      <div className="command-toolbar">
        <div className="command-filter-group" role="tablist">
          <button
            type="button"
            className={`command-filter-btn${filter === 'all' ? ' active' : ''}`}
            onClick={() => setFilter('all')}
          >
            {t('workspace.commandsFilterAll')} ({allCommands.length})
          </button>
          <button
            type="button"
            className={`command-filter-btn${filter === 'failed' ? ' active' : ''}${failedCount > 0 ? ' has-failed' : ''}`}
            onClick={() => setFilter('failed')}
          >
            {t('workspace.commandsFilterFailed')}
            {failedCount > 0 && <span className="failed-count-dot">{failedCount}</span>}
          </button>
          <button
            type="button"
            className={`command-filter-btn${filter === 'agent' ? ' active' : ''}`}
            onClick={() => setFilter('agent')}
          >
            {t('workspace.commandsFilterAgent')}
          </button>
          <button
            type="button"
            className={`command-filter-btn${filter === 'user' ? ' active' : ''}`}
            onClick={() => setFilter('user')}
          >
            {t('workspace.commandsFilterUser')}
          </button>
        </div>
        <div className="command-search-wrap">
          <Search size={12} className="command-search-icon" />
          <input
            type="text"
            className="command-search-input"
            placeholder={t('workspace.commandsSearchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="command-search-clear"
              onClick={() => setSearchQuery('')}
              aria-label={t('review.clearSearch')}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div
        className="command-list custom-scroll"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
            setVisibleCount((prev) => Math.min(prev + 50, filteredCommands.length));
          }
        }}
      >
        {filteredCommands.length === 0 ? (
          <div className="command-list-empty-filtered">
            {t('workspace.commandsEmptyFiltered')}
          </div>
        ) : (
          filteredCommands.slice(0, visibleCount).map((item) => {
            const isRunning = item.status === 'running';
            const open = isRunning || expandedId === item.id;
            return (
              <div
                key={item.id}
                className={`command-run${open ? ' expanded' : ''}${isRunning ? ' running' : ''}`}
                data-testid="command-run"
              >
                <div
                  className="command-run-header"
                  data-testid="command-run-toggle"
                  onClick={() => setExpandedId(open && !isRunning ? null : item.id)}
                >
                  <span className="command-run-chevron">
                    {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </span>
                  <span
                    className={`command-source-badge ${item.source}`}
                    title={t(`workspace.commandsSource${item.source === 'agent' ? 'Agent' : 'User'}`)}
                  >
                    {item.source === 'agent' ? <Bot size={11} /> : <Terminal size={11} />}
                    <span>{item.source === 'agent' ? 'Agent' : t('workspace.commandsSourceUser')}</span>
                  </span>
                  <span className="command-run-name" title={item.command}>
                    $ {item.summary}
                  </span>

                  <div className="command-run-tags">
                    {isRunning ? (
                      <span className="bash-badge running">
                        <span className="tool-terminal-dot tool-terminal-dot-running" />
                        {t('workspace.commandsRunning')}
                      </span>
                    ) : item.status === 'interrupted' ? (
                      <span className="bash-badge interrupted">{t('workspace.commandsInterrupted')}</span>
                    ) : item.status === 'error' || (item.exitCode !== undefined && item.exitCode !== 0) ? (
                      <span className="bash-badge error">
                        {item.exitCode !== undefined
                          ? t('chat.bash.exitCode', { code: item.exitCode })
                          : t('workspace.commandsFailed')}
                      </span>
                    ) : (
                      <span className="bash-badge success">
                        {item.exitCode !== undefined
                          ? t('chat.bash.exitCode', { code: item.exitCode })
                          : t('workspace.commandsSuccess')}
                      </span>
                    )}

                    {item.duration && <span className="command-run-duration">{item.duration}</span>}
                    {item.excludeFromContext && <span className="bash-badge">{t('chat.bash.excluded')}</span>}
                  </div>

                  <div className="command-run-actions">
                    {item.source === 'user' && isRunning && (
                      <button
                        type="button"
                        className="command-run-stop"
                        data-testid="command-run-stop"
                        title={t('chat.command.stopBash')}
                        aria-label={t('chat.command.stopBash')}
                        onClick={(e) => {
                          e.stopPropagation();
                          void paneApi.piRuntime.abortBash();
                        }}
                      >
                        <Square size={11} />
                      </button>
                    )}
                    {item.chatAnchorId && (
                      <button
                        type="button"
                        className="command-item-action-btn"
                        title={t('workspace.commandsJumpToChat')}
                        aria-label={t('workspace.commandsJumpToChat')}
                        onClick={(e) => handleJumpToChat(item, e)}
                      >
                        <Locate size={12} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="command-item-action-btn"
                      title={t('workspace.commandsFillInput')}
                      aria-label={t('workspace.commandsFillInput')}
                      onClick={(e) => handleFillComposer(item, e)}
                    >
                      <CornerDownLeft size={12} />
                    </button>
                    <button
                      type="button"
                      className="command-item-action-btn"
                      title={
                        copiedId === `cmd-${item.id}`
                          ? t('workspace.commandsCopied')
                          : t('workspace.commandsCopyCommand')
                      }
                      aria-label={t('workspace.commandsCopyCommand')}
                      onClick={(e) => handleCopy(item.command, `cmd-${item.id}`, e)}
                    >
                      {copiedId === `cmd-${item.id}` ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                </div>

                {open && (item.output || isRunning) && (
                  <div className="command-run-body">
                    <pre className="command-run-output custom-scroll" data-testid="command-run-output">
                      {item.output || ''}
                      {isRunning && <span className="cursor-blink">▍</span>}
                    </pre>
                    {item.output && (
                      <div className="command-run-footer">
                        <button
                          type="button"
                          className="command-copy-output-btn"
                          onClick={(e) => handleCopy(item.output!, `out-${item.id}`, e)}
                        >
                          {copiedId === `out-${item.id}` ? <Check size={11} /> : <Copy size={11} />}
                          <span>
                            {copiedId === `out-${item.id}`
                              ? t('workspace.commandsCopied')
                              : t('workspace.commandsCopyOutput')}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
