import type { ReactNode, RefObject } from 'react';
import { ChevronRight, FileText, Folder } from 'lucide-react';

export interface ChatInputMentionsPopupProps {
  filePanelOpen: boolean;
  filePanelManual: boolean;
  filePanelRef: RefObject<HTMLDivElement | null>;
  fileMatches: string[];
  fileSelected: number;
  dirTree: { dir: string; dirs: string[]; files: string[] } | null;
  dirContents: Record<string, { dirs: string[]; files: string[] }>;
  expandedDirs: Set<string>;
  onPickFile: (file: string) => void;
  onToggleDir: (name: string, parent: string) => void;
}

export function ChatInputMentionsPopup({
  filePanelOpen,
  filePanelManual,
  filePanelRef,
  fileMatches,
  fileSelected,
  dirTree,
  dirContents,
  expandedDirs,
  onPickFile,
  onToggleDir,
}: ChatInputMentionsPopupProps) {
  if (!filePanelOpen) return null;

  const renderDirTree = (dir: string, content: { dirs: string[]; files: string[] }, depth: number): ReactNode[] => {
    const nodes: ReactNode[] = [];
    for (const name of content.dirs) {
      const full = dir ? `${dir}/${name}` : name;
      const open = expandedDirs.has(full);
      nodes.push(
        <button
          key={`d:${full}`}
          type="button"
          className="command-item file-dir"
          data-testid="file-dir"
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => onToggleDir(name, dir)}
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
      nodes.push(
        <button
          key={`f:${full}`}
          type="button"
          className="command-item"
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
      {filePanelManual ? (
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
