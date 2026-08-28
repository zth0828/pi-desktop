import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUp,
  AtSign,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleGauge,
  Folder,
  GitBranch,
  Paperclip,
  Plus,
  Square,
  Sparkles,
  Terminal,
} from 'lucide-react';
import type { PiModelRow } from '@shared/host-api/contract';
import { formatCost, formatHitRate } from '../../../lib/usage-stats';
import { modelDisplayName, type SendWith, type StagedAttachment } from './types';

export interface ChatInputControlsProps {
  cwd: string;
  onChooseWorkspace: () => Promise<void>;
  composerMenuRef: RefObject<HTMLDivElement | null>;
  composerMenuOpen: boolean;
  setComposerMenuOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  onStageFiles: (files: File[]) => void;
  onOpenFileReference: () => void;
  skills: Array<{ name: string; description?: string }>;
  selectedSkill: string | null;
  setSelectedSkill: (skill: string | null | ((current: string | null) => string | null)) => void;
  setCommandMode: (mode: boolean) => void;
  setAttachments: (setter: (current: StagedAttachment[]) => StagedAttachment[]) => void;
  planMode: boolean;
  setPlanMode: (setter: (on: boolean) => boolean) => void;
  gitBranch: string | null;
  canSwitchBranch: boolean;
  branchMenuRef: RefObject<HTMLDivElement | null>;
  branchMenuOpen: boolean;
  toggleBranchMenu: () => void;
  loadingBranches: boolean;
  branchList: string[];
  switchingBranch: boolean;
  isBranchDirty: boolean;
  onSwitchBranch: (branch: string) => void;
  models: PiModelRow[];
  model: { name?: string; id?: string; maxTokens?: number } | null | undefined;
  selectedModel?: PiModelRow;
  modelKey: string;
  modelMenuRef: RefObject<HTMLDivElement | null>;
  modelMenuOpen: boolean;
  setModelMenuOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  modelMenuSection: 'models' | 'thinking' | null;
  setModelMenuSection: (s: 'models' | 'thinking' | null | ((s: 'models' | 'thinking' | null) => 'models' | 'thinking' | null)) => void;
  modelGroups: Map<string, PiModelRow[]>;
  collapsedProviders: Set<string>;
  toggleProviderCollapse: (provider: string) => void;
  modelQueries: Record<string, string>;
  setModelQueries: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  groupVisibleModels: (provider: string, models: PiModelRow[]) => PiModelRow[];
  applyModelSelection: (key: string) => void;
  onSelectThinkingLevel: (level: string) => void;
  reasoning: boolean;
  thinkingLevel: string | undefined;
  effectiveThinkingLevels: string[];
  isStreaming: boolean;
  isRunning: boolean;
  compacting: boolean;
  retrying: boolean;
  bashing: boolean;
  commandMode: boolean;
  sendWith: SendWith;
  value: string;
  attachmentsLength: number;
  usageControlRef: RefObject<HTMLDivElement | null>;
  usageOpen: boolean;
  setUsageOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  contextLabel: string;
  contextTokens: number | null;
  contextWindow: number;
  contextUsage: { estimated?: boolean } | null | undefined;
  usageTotals: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
  cacheStatsAvailable: boolean;
  totalHitRate: number | null;
  lastTurnHitRate: number | null;
  formatTokens: (val: number | null | undefined) => string;
  onSend: (behavior?: 'steer' | 'followUp') => void;
  onAbort: () => void;
  onFocusTextarea: () => void;
}

export function ChatInputControls({
  cwd,
  onChooseWorkspace,
  composerMenuRef,
  composerMenuOpen,
  setComposerMenuOpen,
  onStageFiles,
  onOpenFileReference,
  skills,
  selectedSkill,
  setSelectedSkill,
  setCommandMode,
  setAttachments,
  planMode,
  setPlanMode,
  gitBranch,
  canSwitchBranch,
  branchMenuRef,
  branchMenuOpen,
  toggleBranchMenu,
  loadingBranches,
  branchList,
  switchingBranch,
  isBranchDirty,
  onSwitchBranch,
  models,
  model,
  selectedModel,
  modelKey,
  modelMenuRef,
  modelMenuOpen,
  setModelMenuOpen,
  modelMenuSection,
  setModelMenuSection,
  modelGroups,
  collapsedProviders,
  toggleProviderCollapse,
  modelQueries,
  setModelQueries,
  groupVisibleModels,
  applyModelSelection,
  onSelectThinkingLevel,
  reasoning,
  thinkingLevel,
  effectiveThinkingLevels,
  isStreaming,
  isRunning,
  compacting,
  retrying,
  bashing,
  commandMode,
  sendWith,
  value,
  attachmentsLength,
  usageControlRef,
  usageOpen,
  setUsageOpen,
  contextLabel,
  contextTokens,
  contextWindow,
  contextUsage,
  usageTotals,
  cacheStatsAvailable,
  totalHitRate,
  lastTurnHitRate,
  formatTokens,
  onSend,
  onAbort,
  onFocusTextarea,
}: ChatInputControlsProps) {
  const { t } = useTranslation();

  const renderModelOption = (m: PiModelRow) => {
    const optionValue = `${m.provider}/${m.id}`;
    return (
      <button
        key={optionValue}
        type="button"
        className="model-option"
        data-testid="model-option"
        data-value={optionValue}
        title={optionValue}
        onClick={() => {
          setModelMenuOpen(false);
          applyModelSelection(optionValue);
        }}
      >
        <span>{modelDisplayName(m)}</span>
        {optionValue === modelKey && <Check size={14} />}
      </button>
    );
  };

  const renderModelSearch = (provider: string, providerModels: PiModelRow[]) => {
    if (providerModels.length <= 5) return null;
    const visible = groupVisibleModels(provider, providerModels);
    return (
      <div className="model-search">
        <input
          className="model-search-input"
          data-testid="model-search"
          data-value={provider}
          placeholder={t('chat.modelMenu.search')}
          value={modelQueries[provider] ?? ''}
          onChange={(e) => setModelQueries((prev) => ({ ...prev, [provider]: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const first = visible[0];
            if (first) {
              setModelMenuOpen(false);
              applyModelSelection(`${first.provider}/${first.id}`);
            }
          }}
        />
      </div>
    );
  };

  return (
    <div className="chat-input-toolbar">
      <div className="composer-menu-wrap" ref={composerMenuRef}>
        <input
          id="chat-attach-input"
          type="file"
          accept="image/*,text/*,.md,.markdown,.json,.yaml,.yml,.toml,.xml,.csv,.log"
          multiple
          hidden
          data-testid="attach-input"
          onChange={(e) => {
            onStageFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
            setComposerMenuOpen(false);
          }}
        />
        <button
          type="button"
          className="attach-button"
          data-testid="composer-menu"
          title={t('chat.composerMenu')}
          aria-expanded={composerMenuOpen}
          onClick={() => setComposerMenuOpen((open) => !open)}
        >
          <Plus size={17} />
        </button>
        {composerMenuOpen && (
          <div className="composer-menu" role="menu" data-testid="composer-menu-panel">
            <label className="composer-menu-item" data-testid="attach-image" htmlFor="chat-attach-input" title={t('chat.attachFile')}>
              <Paperclip size={15} />
              <span>{t('chat.attachFile')}</span>
            </label>
            <button
              type="button"
              className="composer-menu-item"
              data-testid="composer-file-reference"
              onClick={() => {
                setComposerMenuOpen(false);
                onOpenFileReference();
              }}
            >
              <AtSign size={15} />
              <span>{t('chat.fileReference')}</span>
            </button>
            <div className="composer-menu-section">
              <Sparkles size={14} />
              <span>{t('chat.skills')}</span>
            </div>
            <div className="composer-skills-list">
              {skills.length === 0 ? (
                <div className="composer-menu-hint">{t('chat.noSkills')}</div>
              ) : (
                skills.map((skill) => (
                  <button
                    type="button"
                    className="composer-menu-item"
                    data-testid={`composer-skill-${skill.name}`}
                    key={skill.name}
                    onClick={() => {
                      setSelectedSkill((current) => (current === skill.name ? null : skill.name));
                      setComposerMenuOpen(false);
                      onFocusTextarea();
                    }}
                  >
                    <Sparkles size={14} />
                    <span>{skill.name}</span>
                    {selectedSkill === skill.name && <Check size={13} />}
                  </button>
                ))
              )}
            </div>
            <button
              type="button"
              className="composer-menu-item"
              data-testid="composer-command-mode"
              onClick={() => {
                setCommandMode(true);
                setAttachments(() => []);
                setComposerMenuOpen(false);
                onFocusTextarea();
              }}
            >
              <Terminal size={15} />
              <span>{t('chat.command.run')}</span>
            </button>
          </div>
        )}
      </div>
      <div className="composer-tools">
        <button
          type="button"
          className={`composer-tool${planMode ? ' active' : ''}`}
          data-testid="composer-plan-toggle"
          title={planMode ? t('chat.planModeOn') : t('chat.planMode')}
          aria-pressed={planMode}
          onClick={() => setPlanMode((on) => !on)}
        >
          <Brain size={14} />
        </button>
      </div>
      <button
        type="button"
        className="context-chip workspace-chip"
        data-testid="chat-workspace"
        title={cwd}
        onClick={() => void onChooseWorkspace()}
      >
        <Folder size={15} />
        <span>{cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd}</span>
        <ChevronDown size={13} />
      </button>
      {gitBranch && (
        <div className="git-branch-wrap" ref={branchMenuRef}>
          {canSwitchBranch ? (
            <button
              type="button"
              className="context-chip git-branch-chip switchable"
              data-testid="git-branch"
              aria-haspopup="menu"
              aria-expanded={branchMenuOpen}
              title={t('chat.branchSwitch.title')}
              onClick={toggleBranchMenu}
            >
              <GitBranch size={14} />
              <span>{gitBranch === 'detached' ? t('chat.gitDetached') : gitBranch}</span>
              <ChevronDown size={13} />
            </button>
          ) : (
            <span
              className="context-chip git-branch-chip disabled"
              data-testid="git-branch"
              title={t('chat.branchSwitch.locked')}
            >
              <GitBranch size={14} />
              <span>{gitBranch === 'detached' ? t('chat.gitDetached') : gitBranch}</span>
            </span>
          )}
          {branchMenuOpen && (
            <div className="git-branch-menu" data-testid="git-branch-menu" role="menu">
              {loadingBranches && (
                <div className="git-branch-menu-hint">{t('chat.branchSwitch.loading')}</div>
              )}
              {!loadingBranches && branchList.length === 0 && (
                <div className="git-branch-menu-hint">{t('chat.branchSwitch.empty')}</div>
              )}
              {!loadingBranches &&
                branchList.map((branch) => {
                  const isCurrent = branch === gitBranch;
                  return (
                    <button
                      key={branch}
                      type="button"
                      className={`git-branch-option${isCurrent ? ' current' : ''}`}
                      data-testid="git-branch-option"
                      data-value={branch}
                      disabled={switchingBranch}
                      onClick={() => void onSwitchBranch(branch)}
                    >
                      <span>{branch}</span>
                      {isCurrent && <Check size={14} />}
                    </button>
                  );
                })}
              {isBranchDirty && (
                <div className="git-branch-menu-dirty-hint">
                  {t('chat.branchSwitch.dirtyHint')}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <span className="spacer" />
      {(models.length > 0 || model) && (
        <div className="model-menu-wrap" ref={modelMenuRef}>
          <button
            type="button"
            className="model-menu-trigger"
            data-testid="model-select"
            data-value={modelKey}
            aria-label={t('chat.model')}
            aria-expanded={modelMenuOpen}
            title={selectedModel ? `${selectedModel.provider}/${selectedModel.id}` : undefined}
            onClick={() => setModelMenuOpen((open) => !open)}
          >
            <span className="model-menu-trigger-name">
              {selectedModel ? modelDisplayName(selectedModel) : (model?.name ?? model?.id ?? t('chat.model'))}
            </span>
            {reasoning && thinkingLevel && (
              <span className="model-menu-trigger-thinking" data-testid="model-trigger-thinking">
                · {t(`chat.thinkingLevels.${thinkingLevel}`, { defaultValue: thinkingLevel })}
              </span>
            )}
            <ChevronDown size={13} />
          </button>
          {modelMenuOpen && (
            <div className={`model-menu${modelMenuSection ? ' with-submenu' : ''}`} data-testid="model-menu" role="menu">
              {modelMenuSection === 'models' && (
                <div className="model-submenu" data-testid="model-submenu">
                  {models.length === 0 && <div className="composer-menu-hint">{t('chat.modelMenu.empty')}</div>}
                  {modelGroups.size === 1
                    ? [...modelGroups.entries()].map(([provider, providerModels]) => {
                        const visible = groupVisibleModels(provider, providerModels);
                        return (
                          <div key={provider} className="model-group-items" data-testid="model-group-items">
                            {renderModelSearch(provider, providerModels)}
                            {visible.length === 0 && (
                              <div className="composer-menu-hint" data-testid="model-search-empty">{t('chat.modelMenu.noResults')}</div>
                            )}
                            {visible.map(renderModelOption)}
                          </div>
                        );
                      })
                    : [...modelGroups.entries()].map(([provider, providerModels]) => {
                        const isCollapsed = collapsedProviders.has(provider);
                        const visible = groupVisibleModels(provider, providerModels);
                        return (
                          <div key={provider} className="model-group">
                            <button
                              type="button"
                              className="model-group-toggle"
                              data-testid="model-group-toggle"
                              data-value={provider}
                              aria-expanded={!isCollapsed}
                              aria-label={isCollapsed ? t('chat.modelMenu.expandProvider', { provider }) : t('chat.modelMenu.collapseProvider', { provider })}
                              onClick={() => toggleProviderCollapse(provider)}
                            >
                              <span className="model-group-toggle-title">
                                {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                                <span>{provider}</span>
                              </span>
                              <span className="model-group-count">{providerModels.length}</span>
                            </button>
                            {!isCollapsed && (
                              <div className="model-group-items" data-testid="model-group-items">
                                {renderModelSearch(provider, providerModels)}
                                {visible.length === 0 && (
                                  <div className="composer-menu-hint" data-testid="model-search-empty">{t('chat.modelMenu.noResults')}</div>
                                )}
                                {visible.map(renderModelOption)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                </div>
              )}
              {modelMenuSection === 'thinking' && (
                <div className="model-submenu" data-testid="model-submenu">
                  {effectiveThinkingLevels.map((level) => (
                    <button
                      key={level}
                      type="button"
                      className="model-option"
                      data-testid="thinking-option"
                      data-value={level}
                      onClick={() => {
                        setModelMenuOpen(false);
                        onSelectThinkingLevel(level);
                      }}
                    >
                      <span>{t(`chat.thinkingLevels.${level}`, { defaultValue: level })}</span>
                      {level === thinkingLevel && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
              <div className="model-menu-main">
                <button
                  type="button"
                  className={`model-menu-row${modelMenuSection === 'models' ? ' active' : ''}`}
                  data-testid="model-menu-models"
                  onClick={() => setModelMenuSection((s) => (s === 'models' ? null : 'models'))}
                >
                  <span>{t('chat.modelMenu.model')}</span>
                  <span className="model-menu-value">
                    {selectedModel ? modelDisplayName(selectedModel) : (model?.name ?? model?.id ?? '')}
                  </span>
                  <ChevronLeft size={13} />
                </button>
                {reasoning && effectiveThinkingLevels.length > 0 && (
                  <button
                    type="button"
                    className={`model-menu-row${modelMenuSection === 'thinking' ? ' active' : ''}`}
                    data-testid="model-menu-thinking"
                    disabled={isStreaming}
                    onClick={() => setModelMenuSection((s) => (s === 'thinking' ? null : 'thinking'))}
                  >
                    <span>{t('chat.thinkingLevel')}</span>
                    <span className="model-menu-value">{t(`chat.thinkingLevels.${thinkingLevel}`, { defaultValue: thinkingLevel })}</span>
                    <ChevronLeft size={13} />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="usage-control" ref={usageControlRef}>
        <button
          type="button"
          className="usage-button"
          data-testid="token-usage"
          aria-label={t('chat.tokenUsage')}
          aria-expanded={usageOpen}
          onClick={() => setUsageOpen((open) => !open)}
        >
          <CircleGauge size={17} />
          <span>{contextLabel}</span>
        </button>
        {usageOpen && (
          <div className="usage-popover" role="dialog" data-testid="token-usage-popover">
            <div className="usage-popover-title">{t('chat.tokenUsage')}</div>
            <div className="usage-section-label">{t('chat.currentModelUsage')}</div>
            <div className="usage-row" data-testid="usage-context-used">
              <span>{t('chat.contextUsed')}</span>
              <strong>{formatTokens(contextTokens)}</strong>
            </div>
            <div className="usage-row" data-testid="usage-context-window">
              <span>{t('chat.contextWindow')}</span>
              <strong>{formatTokens(contextWindow)}</strong>
            </div>
            {contextUsage?.estimated && (
              <div className="usage-note" data-testid="usage-context-estimated">
                {t('chat.contextEstimated')}
              </div>
            )}
            {(model?.maxTokens ?? selectedModel?.maxTokens) != null && (
              <div className="usage-row" data-testid="usage-max-output">
                <span>{t('chat.maxOutputTokens')}</span>
                <strong>{formatTokens(model?.maxTokens ?? selectedModel?.maxTokens)}</strong>
              </div>
            )}
            <div className="usage-section-label">{t('chat.sessionTotals')}</div>
            <div className="usage-row" data-testid="usage-session-input">
              <span>{t('chat.inputTokens')}</span>
              <strong>{formatTokens(usageTotals.input)}</strong>
            </div>
            <div className="usage-row">
              <span>{t('chat.outputTokens')}</span>
              <strong>{formatTokens(usageTotals.output)}</strong>
            </div>
            {(usageTotals.cacheRead > 0 || usageTotals.cacheWrite > 0) && (
              <>
                <div className="usage-row">
                  <span>{t('chat.cacheRead')}</span>
                  <strong>{formatTokens(usageTotals.cacheRead)}</strong>
                </div>
                <div className="usage-row">
                  <span>{t('chat.cacheWrite')}</span>
                  <strong>{formatTokens(usageTotals.cacheWrite)}</strong>
                </div>
              </>
            )}
            {cacheStatsAvailable && totalHitRate != null && (
              <div className="usage-row" data-testid="usage-session-cache-hit-rate">
                <span>{t('chat.cacheHitRate')}</span>
                <strong>{formatHitRate(totalHitRate)}</strong>
              </div>
            )}
            {cacheStatsAvailable && lastTurnHitRate != null && (
              <div className="usage-row" data-testid="usage-session-cache-hit-rate-last">
                <span>{t('chat.cacheHitRateLast')}</span>
                <strong>{formatHitRate(lastTurnHitRate)}</strong>
              </div>
            )}
            {usageTotals.cost > 0 && (
              <div className="usage-row">
                <span>{t('chat.totalCost')}</span>
                <strong>{formatCost(usageTotals.cost)}</strong>
              </div>
            )}
            <div className="usage-note">{t('chat.cacheStatsNote')}</div>
          </div>
        )}
      </div>
      {isStreaming ? (
        <>
          <button
            type="button"
            data-testid="chat-queue-send"
            className="send-button"
            onClick={() => onSend('steer')}
            disabled={!value.trim() && attachmentsLength === 0}
            title={t('chat.queueSendTipSteer')}
          >
            <ArrowUp size={15} />
          </button>
          <button
            type="button"
            data-testid="chat-stop"
            className="send-button stop"
            onClick={onAbort}
            title={t('chat.stopTip')}
          >
            <Square size={13} />
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            data-testid="chat-send"
            className="send-button"
            onClick={() => onSend()}
            disabled={!value.trim() && attachmentsLength === 0}
            title={
              commandMode && bashing
                ? t('chat.command.runningHint')
                : sendWith === 'cmdEnter'
                  ? t('chat.sendTipCmdEnter')
                  : t('chat.sendTip')
            }
          >
            <ArrowUp size={15} />
          </button>
          {(compacting || retrying || isRunning) && (
            <button
              type="button"
              data-testid="chat-stop"
              className="send-button stop"
              onClick={onAbort}
              title={t('chat.stopTip')}
            >
              <Square size={13} />
            </button>
          )}
        </>
      )}
    </div>
  );
}
