import { useEffect, useRef, useState, type RefObject } from 'react';
import { hostApi } from '../../../lib/host-api';
import { filterFiles } from '../../../lib/file-search';
import { isProbablyBinary } from '@shared/file-references';
import type { AtToken, StagedAttachment } from './types';

export type VisibleTreeItem =
  | { kind: 'dir'; name: string; full: string; parent: string; depth: number; open: boolean }
  | { kind: 'file'; name: string; full: string; depth: number };

export function getVisibleTreeItems(
  dirTree: { dir: string; dirs: string[]; files: string[] } | null,
  dirContents: Record<string, { dirs: string[]; files: string[] }>,
  expandedDirs: Set<string>,
): VisibleTreeItem[] {
  if (!dirTree) return [];
  const items: VisibleTreeItem[] = [];

  function collect(dir: string, content: { dirs: string[]; files: string[] }, depth: number) {
    for (const name of content.dirs) {
      const full = dir ? `${dir}/${name}` : name;
      const open = expandedDirs.has(full);
      items.push({ kind: 'dir', name, full, parent: dir, depth, open });
      const child = dirContents[full];
      if (open && child) {
        collect(full, child, depth + 1);
      }
    }
    for (const name of content.files) {
      const full = dir ? `${dir}/${name}` : name;
      items.push({ kind: 'file', name, full, depth });
    }
  }

  collect('', dirTree, 0);
  return items;
}

export interface UseFileMentionsOptions {
  cwd: string;
  value: string;
  setValue: (next: string | ((current: string) => string)) => void;
  setAttachments: (next: StagedAttachment[] | ((current: StagedAttachment[]) => StagedAttachment[])) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export function useFileMentions({
  cwd,
  value,
  setValue,
  setAttachments,
  textareaRef,
}: UseFileMentionsOptions) {
  const [atToken, setAtToken] = useState<AtToken | null>(null);
  const [atSuppressed, setAtSuppressed] = useState(false);
  const [fileList, setFileList] = useState<string[]>([]);
  const [fileSelected, setFileSelected] = useState(0);
  const [treeSelected, setTreeSelected] = useState(0);
  const [hasNavigated, setHasNavigated] = useState(false);
  const [filePanelManual, setFilePanelManual] = useState(false);
  const [dirTree, setDirTree] = useState<{ dir: string; dirs: string[]; files: string[] } | null>(null);
  const [dirContents, setDirContents] = useState<Record<string, { dirs: string[]; files: string[] }>>({});
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const filePanelRef = useRef<HTMLDivElement>(null);

  const atActive = atToken !== null && !atSuppressed;
  const isTreeMode = filePanelManual || (atActive && (!atToken || atToken.query === ''));
  const fileMatches = atActive && atToken?.query ? filterFiles(fileList, atToken.query) : filterFiles(fileList, '');
  const visibleTreeItems = getVisibleTreeItems(dirTree, dirContents, expandedDirs);
  const filePanelOpen = filePanelManual || (atActive && (isTreeMode ? dirTree !== null : fileMatches.length > 0));

  useEffect(() => {
    if (!cwd) return;
    void hostApi.piFiles.list(cwd).then((r) => setFileList(r.files)).catch(() => {});
    void hostApi.piFiles.listDir(cwd).then((r) => setDirTree(r)).catch(() => setDirTree(null));
  }, [cwd]);

  useEffect(() => {
    if (!atActive && !filePanelManual) return;
    if (!dirTree) {
      void hostApi.piFiles.listDir(cwd).then((r) => setDirTree(r)).catch(() => setDirTree(null));
    }
    void hostApi.piFiles.list(cwd).then((r) => setFileList(r.files)).catch(() => {});
  }, [atActive, filePanelManual, cwd, dirTree]);

  useEffect(() => {
    setFileSelected(0);
    setTreeSelected(0);
    setHasNavigated(false);
  }, [atToken?.query, cwd]);

  useEffect(() => {
    if (!filePanelOpen) return;
    filePanelRef.current
      ?.querySelector<HTMLElement>('.command-item.selected')
      ?.scrollIntoView({ block: 'nearest' });
  }, [atToken?.query, filePanelOpen, fileSelected, treeSelected, isTreeMode]);

  /** 选中文件：把光标处的 @query 替换为附件（若文件读取暂未就绪则插入 @path） */
  const pickFile = async (relPath: string) => {
    const result = await hostApi.workspace.readFile(relPath).catch(() => null);
    if (!result) {
      if (filePanelManual) setFilePanelManual(false);
      const inserted = relPath.includes(' ') ? `@"${relPath}" ` : `@${relPath} `;
      if (atToken) {
        setValue(value.slice(0, atToken.start) + inserted + value.slice(atToken.end));
        setAtToken(null);
      } else {
        setValue((prev) => (typeof prev === 'string' ? prev + inserted : inserted));
      }
      setAtSuppressed(true);
      textareaRef.current?.focus();
      return;
    }
    if (result.kind === 'image' && result.data) {
      const mediaType = result.mimeType ?? 'image/png';
      const data = result.data;
      setAttachments((current) => [...current, {
        kind: 'image',
        name: result.name,
        data,
        mediaType,
        previewUrl: `data:${mediaType};base64,${data}`,
      }]);
    } else {
      const text = result.text;
      if (text && !isProbablyBinary(text)) {
        setAttachments((current) => [...current, { kind: 'file', name: relPath, text }]);
      } else {
        setAttachments((current) => [
          ...current,
          { kind: 'file', name: relPath, text: `[binary attachment: ${result.name}, ${result.size} bytes]` },
        ]);
      }
    }
    if (filePanelManual) setFilePanelManual(false);
    if (atToken) {
      setValue(value.slice(0, atToken.start) + value.slice(atToken.end));
      setAtToken(null);
    }
    setAtSuppressed(true);
    textareaRef.current?.focus();
  };

  /** 目录节点展开/收起：首展开时按需加载子目录内容。 */
  const toggleDir = (name: string, parent: string) => {
    const full = parent ? `${parent}/${name}` : name;
    if (expandedDirs.has(full)) {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        next.delete(full);
        return next;
      });
      return;
    }
    setExpandedDirs((prev) => new Set(prev).add(full));
    if (!dirContents[full]) {
      void hostApi.piFiles.listDir(cwd, full).then((r) => {
        setDirContents((prev) => ({ ...prev, [full]: r }));
      }).catch(() => {});
    }
  };

  const handleFileKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return false;
    if (!filePanelOpen) return false;
    if (isTreeMode) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHasNavigated(true);
        setTreeSelected((i) => Math.min(i + 1, Math.max(0, visibleTreeItems.length - 1)));
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHasNavigated(true);
        setTreeSelected((i) => Math.max(i - 1, 0));
        return true;
      }
      if (e.key === 'Tab') {
        const item = visibleTreeItems[treeSelected] ?? visibleTreeItems[0];
        if (!item) return false;
        e.preventDefault();
        if (item.kind === 'dir') {
          toggleDir(item.name, item.parent);
        } else {
          void pickFile(item.full);
        }
        return true;
      }
      if (e.key === 'Enter') {
        if (hasNavigated) {
          const item = visibleTreeItems[treeSelected] ?? visibleTreeItems[0];
          if (!item) return false;
          e.preventDefault();
          if (item.kind === 'dir') {
            toggleDir(item.name, item.parent);
          } else {
            void pickFile(item.full);
          }
          return true;
        }
        setAtSuppressed(true);
        setFilePanelManual(false);
        return false;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setAtSuppressed(true);
        setFilePanelManual(false);
        return true;
      }
      return false;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHasNavigated(true);
      setFileSelected((i) => Math.min(i + 1, Math.max(0, fileMatches.length - 1)));
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHasNavigated(true);
      setFileSelected((i) => Math.max(i - 1, 0));
      return true;
    }
    if (e.key === 'Tab') {
      const match = fileMatches[fileSelected] ?? fileMatches[0];
      if (!match) return false;
      e.preventDefault();
      void pickFile(match);
      return true;
    }
    if (e.key === 'Enter') {
      if (hasNavigated) {
        const match = fileMatches[fileSelected] ?? fileMatches[0];
        if (!match) return false;
        e.preventDefault();
        void pickFile(match);
        return true;
      }
      setAtSuppressed(true);
      setFilePanelManual(false);
      return false;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setAtSuppressed(true);
      setFilePanelManual(false);
      return true;
    }
    return false;
  };

  return {
    atToken,
    setAtToken,
    atSuppressed,
    setAtSuppressed,
    atActive,
    isTreeMode,
    fileList,
    fileSelected,
    setFileSelected,
    treeSelected,
    setTreeSelected,
    fileMatches,
    visibleTreeItems,
    filePanelOpen,
    filePanelManual,
    setFilePanelManual,
    dirTree,
    setDirTree,
    dirContents,
    setDirContents,
    expandedDirs,
    setExpandedDirs,
    filePanelRef,
    pickFile,
    toggleDir,
    handleFileKeyDown,
  };
}
