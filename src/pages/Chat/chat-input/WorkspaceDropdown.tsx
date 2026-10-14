import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, FileEdit, Folder, FolderPlus, Search } from 'lucide-react';
import { isScratchpadCwd } from '../../../lib/session-groups';

export interface WorkspaceDropdownProps {
  open: boolean;
  onClose: () => void;
  currentCwd: string;
  recentProjects: Array<{ cwd: string; name: string }>;
  onSelectProject: (cwd: string) => void;
  onOpenDirectory: () => void;
  onSelectNoProject: () => void;
}

export function WorkspaceDropdown({
  open,
  onClose,
  currentCwd,
  recentProjects,
  onSelectProject,
  onOpenDirectory,
  onSelectNoProject,
}: WorkspaceDropdownProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  const isCurrentScratchpad = isScratchpadCwd(currentCwd);

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recentProjects;
    return recentProjects.filter((p) => p.name.toLowerCase().includes(q) || p.cwd.toLowerCase().includes(q));
  }, [recentProjects, search]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="workspace-dropdown-menu" ref={menuRef} data-testid="workspace-dropdown-menu" role="menu">
      {recentProjects.length > 3 && (
        <div className="workspace-dropdown-search">
          <Search size={13} className="search-icon" />
          <input
            type="text"
            placeholder={t('chat.workspace.searchProjects')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
      )}

      <div className="workspace-dropdown-section">
        {filteredProjects.map((proj) => {
          const isSelected = !isCurrentScratchpad && proj.cwd === currentCwd;
          return (
            <button
              key={proj.cwd}
              type="button"
              className={`workspace-dropdown-item${isSelected ? ' selected' : ''}`}
              title={proj.cwd}
              onClick={() => {
                onSelectProject(proj.cwd);
                onClose();
              }}
            >
              <Folder size={14} className="item-icon" />
              <span className="item-name">{proj.name}</span>
              {isSelected && <Check size={14} className="check-icon" />}
            </button>
          );
        })}
      </div>

      <div className="workspace-dropdown-divider" />

      <div className="workspace-dropdown-section">
        <button
          type="button"
          className="workspace-dropdown-item"
          onClick={() => {
            onClose();
            onOpenDirectory();
          }}
        >
          <FolderPlus size={14} className="item-icon" />
          <span className="item-name">{t('chat.workspace.openOtherFolder')}</span>
        </button>

        <button
          type="button"
          className={`workspace-dropdown-item scratchpad-item${isCurrentScratchpad ? ' selected' : ''}`}
          onClick={() => {
            onClose();
            onSelectNoProject();
          }}
        >
          <FileEdit size={14} className="item-icon" />
          <span className="item-name">{t('chat.workspace.noProject')}</span>
          <span className="item-hint">{t('chat.workspace.noProjectDesc')}</span>
          {isCurrentScratchpad && <Check size={14} className="check-icon" />}
        </button>
      </div>
    </div>
  );
}
