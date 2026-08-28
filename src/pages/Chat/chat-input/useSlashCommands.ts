import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { PiCommandRow, PiRuntimeSessionInfo } from '@shared/host-api/contract';
import { hostApi } from '../../../lib/host-api';
import { navigateToPage } from '../../../lib/app-navigation';
import type { ChatMessage } from '../../../stores/chat';

export interface UseSlashCommandsOptions {
  value: string;
  setValue: (next: string | ((current: string) => string)) => void;
  paneApi: ReturnType<typeof import('../chat-store-context').usePaneHostApi>;
  chatStore: ReturnType<typeof import('../chat-store-context').usePaneChatStoreApi>;
  newSession: () => void;
  setTreeOpen: (open: boolean) => void;
  setModelMenuSection: (sec: 'models' | 'thinking' | null) => void;
  setModelMenuOpen: (open: boolean) => void;
  applyModelSelection: (key: string) => void;
  models: Array<{ id: string; provider: string; name?: string }>;
  showNotice: (text: string) => void;
  setSessionInfo: (info: PiRuntimeSessionInfo) => void;
  contextPercent: number | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  setSelectedSkill?: (skill: string | null | ((curr: string | null) => string | null)) => void;
}

function lastAssistantText(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    const text = m.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n')
      .trim();
    if (text) return text;
  }
  return null;
}

const DEFAULT_BUILTIN_COMMANDS: PiCommandRow[] = [
  { name: 'new', description: 'Start a new session', source: 'built-in' },
  { name: 'tree', description: 'View session branches', source: 'built-in' },
  { name: 'compact', description: 'Compact conversation context', source: 'built-in' },
  { name: 'model', description: 'Select active model', source: 'built-in' },
  { name: 'name', description: 'Set session name', source: 'built-in' },
  { name: 'session', description: 'Show session details', source: 'built-in' },
  { name: 'plan', description: 'Toggle plan mode', source: 'built-in' },
  { name: 'copy', description: 'Copy last assistant response', source: 'built-in' },
  { name: 'export', description: 'Export session to markdown', source: 'built-in' },
  { name: 'settings', description: 'Open settings', source: 'built-in' },
  { name: 'skills', description: 'Manage skills', source: 'built-in' },
  { name: 'extensions', description: 'Manage extensions', source: 'built-in' },
  { name: 'mcp', description: 'Manage MCP servers', source: 'built-in' },
  { name: 'models', description: 'Manage models & providers', source: 'built-in' },
  { name: 'resume', description: 'Switch sessions', source: 'built-in' },
  { name: 'reload', description: 'Reload extensions and skills', source: 'built-in' },
];

export function useSlashCommands({
  value,
  setValue,
  paneApi,
  chatStore,
  newSession,
  setTreeOpen,
  setModelMenuSection,
  setModelMenuOpen,
  applyModelSelection,
  models,
  showNotice,
  setSessionInfo,
  contextPercent,
  textareaRef,
  setSelectedSkill,
}: UseSlashCommandsOptions) {
  const { t } = useTranslation();
  const [commands, setCommands] = useState<PiCommandRow[]>(DEFAULT_BUILTIN_COMMANDS);
  const [selected, setSelected] = useState(0);
  const commandPanelRef = useRef<HTMLDivElement>(null);

  const [hasNavigated, setHasNavigated] = useState(false);

  useEffect(() => {
    void paneApi.piRuntime.getCommands()
      .then((r) => {
        if (r.commands && r.commands.length > 0) {
          const map = new Map<string, PiCommandRow>();
          for (const c of DEFAULT_BUILTIN_COMMANDS) map.set(c.name, c);
          for (const c of r.commands) map.set(c.name, c);
          setCommands(Array.from(map.values()));
        }
      })
      .catch(() => {});
  }, [paneApi]);

  const trimmedLeading = value.replace(/^\s+/, '');
  const query = trimmedLeading.startsWith('/') && !trimmedLeading.includes(' ')
    ? trimmedLeading.slice(1)
    : null;
  const sourceRank = (source: string) =>
    source === 'built-in' ? 0 : source.startsWith('prompt') ? 1 : 2;

  const matches = query === null
    ? []
    : (() => {
        const filtered = commands
          .filter((c) => {
            if (query === '') return sourceRank(c.source) < 2;
            return c.name.toLowerCase().includes(query.toLowerCase());
          })
          .sort((a, b) => {
            const qa = query.toLowerCase();
            const pa = a.name.toLowerCase().startsWith(qa) ? 0 : 1;
            const pb = b.name.toLowerCase().startsWith(qa) ? 0 : 1;
            return pa - pb || sourceRank(a.source) - sourceRank(b.source) || a.name.localeCompare(b.name);
          });
        return query === '' ? filtered : filtered.slice(0, 8);
      })();

  const panelOpen = matches.length > 0;

  useEffect(() => {
    setSelected(0);
    setHasNavigated(false);
  }, [query]);

  useEffect(() => {
    if (!panelOpen) return;
    commandPanelRef.current
      ?.querySelector<HTMLElement>('.command-item.selected')
      ?.scrollIntoView({ block: 'nearest' });
  }, [panelOpen, query, selected]);

  const commandDescription = (cmd: PiCommandRow): string => {
    if (cmd.source !== 'built-in') return cmd.description ?? '';
    if (cmd.name === 'compact') {
      return contextPercent == null
        ? t('chat.commands.compactUnknown')
        : t('chat.commands.compact', { percent: Math.round(contextPercent) });
    }
    return t(`chat.commands.${cmd.name}`);
  };

  const runBuiltinCommand = async (name: string, arg: string) => {
    switch (name) {
      case 'new':
        newSession();
        return;
      case 'tree':
        setTreeOpen(true);
        return;
      case 'compact':
        return void paneApi.piRuntime.compact(arg || undefined);
      case 'model': {
        if (!arg) {
          setModelMenuSection('models');
          setModelMenuOpen(true);
          return;
        }
        const needle = arg.toLowerCase();
        const target = models.find(
          (m) =>
            `${m.provider}/${m.id}`.toLowerCase() === needle ||
            m.id.toLowerCase() === needle ||
            (m.name && m.name.toLowerCase().includes(needle)),
        );
        if (!target) {
          showNotice(t('chat.notice.modelNotFound', { model: arg }));
          return;
        }
        applyModelSelection(`${target.provider}/${target.id}`);
        showNotice(t('chat.notice.modelSet', { model: target.name ?? target.id }));
        return;
      }
      case 'name': {
        if (!arg) {
          const info = await paneApi.piRuntime.getSessionInfo().catch(() => null);
          showNotice(
            info?.name
              ? t('chat.notice.currentName', { name: info.name })
              : t('chat.notice.nameUsage'),
          );
          return;
        }
        const result = await paneApi.piRuntime.setSessionName(arg);
        if (result.success) showNotice(t('chat.notice.renamed', { name: result.name ?? arg }));
        else showNotice(t('chat.notice.renameFailed', { message: result.error ?? 'unknown' }));
        return;
      }
      case 'copy': {
        const text = lastAssistantText(chatStore.getState().messages);
        if (!text) {
          showNotice(t('chat.notice.nothingToCopy'));
          return;
        }
        await hostApi.app.writeClipboard(text);
        showNotice(t('chat.notice.copied'));
        return;
      }
      case 'export': {
        const result = await paneApi.piRuntime.exportHtml(arg || undefined);
        if (result.success) showNotice(t('chat.notice.exported', { path: result.path ?? '' }));
        else showNotice(t('chat.notice.exportFailed', { message: result.error ?? 'unknown' }));
        return;
      }
      case 'session': {
        const info = await paneApi.piRuntime.getSessionInfo().catch(() => null);
        if (info) setSessionInfo(info);
        return;
      }
      case 'settings':
        return navigateToPage('settings');
      case 'login':
      case 'logout':
        return navigateToPage('models');
      case 'resume':
        return navigateToPage('sessions');
      case 'reload': {
        const result = await paneApi.piRuntime.reload();
        if (result.success) {
          showNotice(t('chat.notice.reloaded'));
          void paneApi.piRuntime.getCommands().then((r) => setCommands(r.commands));
        } else {
          showNotice(t('chat.notice.reloadFailed', { message: result.error ?? 'unknown' }));
        }
        return;
      }
      default:
        return;
    }
  };

  const pick = (cmd: PiCommandRow) => {
    if (cmd.name === 'name') {
      setValue('/name ');
      textareaRef.current?.focus();
      return;
    }
    if (cmd.source === 'built-in') {
      setValue('');
      void runBuiltinCommand(cmd.name, '');
      return;
    }
    if (cmd.source === 'skill' || cmd.name.startsWith('skill:')) {
      const skillName = cmd.name.startsWith('skill:') ? cmd.name.slice(6) : cmd.name;
      if (setSelectedSkill) {
        setSelectedSkill(skillName);
        setValue('');
        textareaRef.current?.focus();
        return;
      }
    }
    setValue(`/${cmd.name} `);
    textareaRef.current?.focus();
  };

  const handleCommandKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return false;
    if (!panelOpen) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHasNavigated(true);
      setSelected((i) => Math.min(i + 1, matches.length - 1));
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHasNavigated(true);
      setSelected((i) => Math.max(i - 1, 0));
      return true;
    }
    if (e.key === 'Tab' || e.key === ' ') {
      e.preventDefault();
      pick(matches[selected] ?? matches[0]);
      return true;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      return true;
    }
    if (e.key === 'Escape') {
      setValue('');
      return true;
    }
    return false;
  };

  return {
    commands,
    setCommands,
    selected,
    setSelected,
    matches,
    panelOpen,
    commandPanelRef,
    commandDescription,
    runBuiltinCommand,
    pick,
    handleCommandKeyDown,
  };
}
