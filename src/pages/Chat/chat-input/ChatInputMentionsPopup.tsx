import type { ReactNode, RefObject } from 'react';
import { ChevronRight, FileText, Folder } from 'lucide-react';

export interface ChatInputMentionsPopupProps {
  filePanelOpen: boolean;
  filePanelManual: boolean;
  isTreeMode: boolean;
  filePanelRef: RefObject<HTMLDivElement | null>;
  fileMatches: string[];
  fileSelected: number;
  treeSelected: number;
  dirTree: { dir: string; dirs: string[]; files: string[] } | null;
  dirContents: Record<string, { dirs: string[]; files: string[] }>;
  expandedDirs: Set<string>;
  onPickFile: (file: string) => void;
  onToggleDir: (name: string, parent: string) => void;
  onSelectTreeIndex?: (index: number) => void;
}

export function ChatInputMentionsPopup({
  filePanelOpen,
  isTreeMode,
  filePanelRef,
  fileMatches,
  fileSelected,
  treeSelected,
  dirTree,
  dirContents,
  expandedDirs,
  onPickFile,
  onToggleDir,
  onSelectTreeIndex,
}: ChatInputMentionsPopupProps) {
  if (!filePanelOpen) return null;

  let currentIndex = 0;

  const renderDirTree = (dir: string, content: { dirs: string[]; files: string[] }, depth: number): ReactNode[] => {
    const nodes: ReactNode[] = [];
    for (const name of content.dirs) {
      const full = dir ? `${dir}/${name}` : name;
      const open = expandedDirs.has(full);
      const index = currentIndex++;
      const isSelected = isTreeMode && index === treeSelected;
      nodes.push(
        <button
          key={`d:${full}`}
          type="button"
          className={`command-item file-dir${isSelected ? ' selected' : ''}`}
          data-testid="file-dir"
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => {
            onToggleDir(name, dir);
            onSelectTreeIndex?.(index);
          }}
        >
          <ChevronRight size={12} className={`file-dir-chevron${open ? ' open' : ''}`} />
          <Folder size={13} />
          <span className="command-name">{name}</span>
        </button>,
      );
      const child = dirContents[full];
      if (open && child) nodes.push(...renderDirTree(full, child, depth + 1));
    }
    for (const name of content.files) {
      const full = dir ? `${dir}/${name}` : name;
      const index = currentIndex++;
      const isSelected = isTreeMode && index === treeSelected;
      nodes.push(
        <button
          key={`f:${full}`}
          type="button"
          className={`command-item${isSelected ? ' selected' : ''}`}
          data-testid="file-option"
          style={{ paddingLeft: 10 + depth * 14 + 18 }}
          onMouseDown={(e) => {
            e.preventDefault();
            onPickFile(full);
          }}
        >
          <FileText size={13} />
          <span className="command-name">{name}</span>
        </button>,
      );
    }
    return nodes;
  };

  return (
    <div ref={filePanelRef} className="command-panel" data-testid="file-panel">
      {isTreeMode ? (
        dirTree ? renderDirTree('', dirTree, 0) : null
      ) : (
        fileMatches.map((file, i) => (
          <button
            key={file}
            type="button"
            className={i === fileSelected ? 'command-item selected' : 'command-item'}
            data-testid="file-option"
            onMouseDown={(e) => {
              e.preventDefault();
              onPickFile(file);
            }}
          >
            <FileText size={13} />
            <span className="command-name">@{file}</span>
          </button>
        ))
      )}
    </div>
  );
}
