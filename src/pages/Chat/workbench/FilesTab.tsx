import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Folder, FolderOpen, LoaderCircle, Search } from 'lucide-react';
import type { WorkspaceEntry } from '@shared/host-api/contract';
import { hostApi } from '../../../lib/host-api';
import { FileIcon } from '../../../components/FileIcon';
import { usePaneChatStore } from '../chat-store-context';

export function FileExplorer({
  selected,
  onSelect,
  onRootCount,
}: {
  selected: string | null;
  onSelect: (path: string) => void;
  onRootCount: (count: number) => void;
}) {
  const { t } = useTranslation();
  const cwd = usePaneChatStore((state) => state.cwd);
  const [children, setChildren] = useState<Record<string, WorkspaceEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const loadedRef = useRef(new Set<string>());
  const loadingRef = useRef(new Set<string>());
  const generationRef = useRef(0);

  const load = useCallback(async (dir: string) => {
    if (loadedRef.current.has(dir) || loadingRef.current.has(dir)) return;
    const generation = generationRef.current;
    loadingRef.current.add(dir);
    setLoading(new Set(loadingRef.current));
    const result = await hostApi.workspace.listChildren(dir).catch(() => null);
    if (generation !== generationRef.current) return;
    loadingRef.current.delete(dir);
    setLoading(new Set(loadingRef.current));
    if (!result) return;
    loadedRef.current.add(dir);
    setChildren((current) => ({ ...current, [dir]: result.entries }));
    if (dir === '') onRootCount(result.entries.length);
  }, [onRootCount]);

  useEffect(() => {
    generationRef.current += 1;
    loadedRef.current.clear();
    loadingRef.current.clear();
    setChildren({});
    setExpanded(new Set(['']));
    setLoading(new Set());
    setFilter('');
    onRootCount(0);
    void load('');
  }, [cwd, load, onRootCount]);

  const toggle = (entry: WorkspaceEntry) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
    if (!loadedRef.current.has(entry.path)) void load(entry.path);
  };

  const renderEntries = (dir: string, depth: number): ReactNode =>
    (children[dir] ?? []).map((entry) => {
      const open = expanded.has(entry.path);
      const matches = !filter || entry.path.toLowerCase().includes(filter.toLowerCase());
      if (filter && entry.kind === 'file' && !matches) return null;
      return (
        <div key={entry.path}>
          <button
            className={`workspace-tree-row${selected === entry.path ? ' selected' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            data-testid={entry.kind === 'file' ? 'workspace-file' : 'workspace-directory'}
            title={entry.path}
            draggable={entry.kind === 'file'}
            onDragStart={
              entry.kind === 'file'
                ? (e) => {
                    e.dataTransfer.setData('application/x-pi-file-mention', entry.path);
                    const formatted = entry.path.includes(' ') ? `@"${entry.path}" ` : `@${entry.path} `;
                    e.dataTransfer.setData('text/plain', formatted);
                    e.dataTransfer.effectAllowed = 'copy';
                  }
                : undefined
            }
            onClick={() => (entry.kind === 'directory' ? toggle(entry) : onSelect(entry.path))}
          >
            {entry.kind === 'directory' ? (
              <>
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {open ? <FolderOpen size={14} /> : <Folder size={14} />}
              </>
            ) : (
              <>
                <span className="workspace-tree-indent" />
                <FileIcon name={entry.name} size={14} />
              </>
            )}
            <span>{entry.name}</span>
          </button>
          {entry.kind === 'directory' && open && renderEntries(entry.path, depth + 1)}
          {entry.kind === 'directory' && open && loading.has(entry.path) && (
            <div className="workspace-tree-loading" style={{ paddingLeft: 29 + (depth + 1) * 14 }}>
              <LoaderCircle size={13} />
              {t('workspace.loadingFolder')}
            </div>
          )}
        </div>
      );
    });

  return (
    <aside className="workspace-tree" data-testid="workspace-tree">
      <label className="workspace-filter">
        <Search size={14} />
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={t('workspace.filter')} />
      </label>
      <div className="workspace-tree-scroll">
        {loading.has('') && (
          <div className="workspace-tree-loading">
            <LoaderCircle size={13} />
            {t('workspace.loadingFolder')}
          </div>
        )}
        {renderEntries('', 0)}
      </div>
    </aside>
  );
}
