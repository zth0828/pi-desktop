import { useEffect, useRef, useState, type RefObject } from 'react';
import { hostApi } from '../../../lib/host-api';
import { filterFiles } from '../../../lib/file-search';
import { isProbablyBinary } from '@shared/file-references';
import type { AtToken, StagedAttachment } from './types';

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
  const [filePanelManual, setFilePanelManual] = useState(false);
  const [dirTree, setDirTree] = useState<{ dir: string; dirs: string[]; files: string[] } | null>(null);
  const [dirContents, setDirContents] = useState<Record<string, { dirs: string[]; files: string[] }>>({});
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const filePanelRef = useRef<HTMLDivElement>(null);

  const atActive = atToken !== null && !atSuppressed;
  const fileMatches = atActive ? filterFiles(fileList, atToken.query) : filterFiles(fileList, '');
  const filePanelOpen = filePanelManual || (atActive && fileMatches.length > 0);

  useEffect(() => {
    if (!atActive && !filePanelManual) return;
    void hostApi.piFiles.list(cwd).then((r) => setFileList(r.files)).catch(() => {});
  }, [atActive, filePanelManual, cwd]);

  useEffect(() => {
    setFileSelected(0);
  }, [atToken?.query]);

  useEffect(() => {
    if (!filePanelOpen) return;
    filePanelRef.current
      ?.querySelector<HTMLElement>('.command-item.selected')
      ?.scrollIntoView({ block: 'nearest' });
  }, [atToken?.query, filePanelOpen, fileSelected]);

  /** 选中文件：把光标处的 @query 替换为附件 */
  const pickFile = async (relPath: string) => {
    const result = await hostApi.workspace.readFile(relPath).catch(() => null);
    if (!result) {
      if (filePanelManual) setFilePanelManual(false);
      if (atToken) {
        setValue(value.slice(0, atToken.start) + value.slice(atToken.end));
        setAtToken(null);
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
    if (!filePanelOpen) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFileSelected((i) => Math.min(i + 1, fileMatches.length - 1));
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFileSelected((i) => Math.max(i - 1, 0));
      return true;
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      void pickFile(fileMatches[fileSelected] ?? fileMatches[0]);
      return true;
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
    fileList,
    fileSelected,
    setFileSelected,
    fileMatches,
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
