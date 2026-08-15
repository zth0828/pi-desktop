import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  PiSkillImportStrategy,
  PiSkillRow,
  PiSkillScanExternalResult,
} from '@shared/host-api/contract';
import { hostApi } from '../lib/host-api';
import { Markdown } from '../components/Markdown';
import { useActiveChatStore } from './Chat/chat-store-context';

/** 导入对话框里每个 skill 的选择态（key = `${sourceId}:${name}`） */
type ImportSelection = { dir: string; strategy: PiSkillImportStrategy };

function selectionKey(sourceId: string, name: string): string {
  return `${sourceId}:${name}`;
}

export default function SkillsPage() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<PiSkillRow[]>([]);
  const [query, setQuery] = useState('');
  const [runtimeActive, setRuntimeActive] = useState(false);
  const [error, setError] = useState<string>();
  const [viewing, setViewing] = useState<{ name: string; content: string }>();
  const [viewLoading, setViewLoading] = useState<string>();
  const [importData, setImportData] = useState<PiSkillScanExternalResult>();
  const [importOpen, setImportOpen] = useState(false);
  const [selections, setSelections] = useState<Record<string, ImportSelection>>({});
  const [manualDirs, setManualDirs] = useState<string[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importSummary, setImportSummary] = useState<string>();
  const chatStarted = useActiveChatStore((s) => s.started);

  const refresh = useCallback(() => {
    hostApi.piSkills
      .list()
      .then((r) => {
        setSkills(r.skills);
        setRuntimeActive(r.runtimeActive);
        setError(undefined);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  // runtime 启动（Chat 页恢复 workspace 后）再拉一次
  useEffect(refresh, [refresh, chatStarted]);

  const openViewer = async (skill: PiSkillRow) => {
    setViewLoading(skill.name);
    try {
      const { content } = await hostApi.piSkills.read(skill.filePath);
      setViewing({ name: skill.name, content });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setViewLoading(undefined);
    }
  };

  const scanExternal = useCallback(async (extraDirs: string[]) => {
    const data = await hostApi.piSkills.scanExternal(extraDirs);
    setImportData(data);
    // 默认选中所有 new；same/conflict 不选，由用户逐个决定
    const defaults: Record<string, ImportSelection> = {};
    for (const source of data.sources) {
      for (const skill of source.skills) {
        if (skill.status === 'new') {
          defaults[selectionKey(source.id, skill.name)] = { dir: skill.dir, strategy: 'skip' };
        }
      }
    }
    setSelections(defaults);
  }, []);

  const openImport = () => {
    setImportOpen(true);
    setImportSummary(undefined);
    void scanExternal(manualDirs).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  const pickDirectory = async () => {
    const result = await hostApi.dialog.openDirectory(t('skills.importPickDirectory'));
    const dir = result.filePaths[0];
    if (result.canceled || !dir || manualDirs.includes(dir)) return;
    const next = [...manualDirs, dir];
    setManualDirs(next);
    await scanExternal(next).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  const toggleSelection = (sourceId: string, skill: { name: string; dir: string; status: string }) => {
    setSelections((current) => {
      const key = selectionKey(sourceId, skill.name);
      const next = { ...current };
      if (next[key]) delete next[key];
      else next[key] = { dir: skill.dir, strategy: 'skip' };
      return next;
    });
  };

  const setStrategy = (sourceId: string, name: string, strategy: PiSkillImportStrategy) => {
    setSelections((current) => {
      const key = selectionKey(sourceId, name);
      return current[key] ? { ...current, [key]: { ...current[key], strategy } } : current;
    });
  };

  const confirmImport = async () => {
    const items = Object.entries(selections).map(([key, sel]) => ({
      name: key.slice(key.indexOf(':') + 1),
      dir: sel.dir,
      strategy: sel.strategy,
    }));
    if (items.length === 0) return;
    setImportBusy(true);
    try {
      const { results } = await hostApi.piSkills.import(items);
      const done = results.filter((r) => r.ok && r.action !== 'skipped').length;
      setImportSummary(t('skills.importSummary', { count: done }));
      setImportOpen(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportBusy(false);
    }
  };

  const selectedCount = Object.keys(selections).length;

  return (
    <div className="skills-page">
      <h2>{t('skills.title')}</h2>
      <p className="hint">{t('skills.readonlyHint')}</p>
      <div className="skills-toolbar">
        <input
          className="search-input"
          data-testid="skills-search"
          placeholder={t('list.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="pill" data-testid="skills-import-open" onClick={openImport}>
          {t('skills.import')}
        </button>
      </div>
      {importSummary && (
        <p className="hint" data-testid="skills-import-summary">{importSummary}</p>
      )}
      {error && (
        <div data-testid="skills-error">
          <p className="error-text">{error}</p>
          <button data-testid="skills-retry" onClick={refresh}>
            {t('states.retry')}
          </button>
        </div>
      )}
      {!runtimeActive && !error ? (
        <p className="hint" data-testid="skills-no-runtime">{t('skills.noRuntime')}</p>
      ) : skills.length === 0 && !error ? (
        <p className="hint" data-testid="skills-empty">{t('skills.empty')}</p>
      ) : (
        <div className="skill-list">
          {skills
            .filter((s) => !query || s.name.toLowerCase().includes(query.toLowerCase()))
            .map((s) => (
            <div className="skill-row" data-testid={`skill-row-${s.name}`} key={`${s.source}:${s.filePath}`}>
              <div className="skill-row-main">
                <span className="skill-name">{s.name}</span>
                <span className={`skill-source-badge source-${s.source}`} data-testid="skill-source">
                  {t(`skills.source.${s.source}`)}
                </span>
                {s.disableModelInvocation && (
                  <span className="skill-source-badge">{t('skills.manualOnly')}</span>
                )}
                <button
                  className="pill skill-view-button"
                  data-testid={`skill-view-${s.name}`}
                  disabled={viewLoading === s.name}
                  onClick={() => void openViewer(s)}
                >
                  {t('skills.view')}
                </button>
              </div>
              {s.description && <p className="skill-desc">{s.description}</p>}
              <p className="skill-path hint" title={s.filePath}>
                {s.filePath}
                {s.sourceDetail ? ` · ${s.sourceDetail}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      {viewing && (
        <div className="skill-view-overlay" data-testid="skill-view-overlay" onClick={() => setViewing(undefined)}>
          <div className="skill-view-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="skill-view-header">
              <strong>{viewing.name}</strong>
              <button className="pill" data-testid="skill-view-close" onClick={() => setViewing(undefined)}>
                {t('skills.close')}
              </button>
            </div>
            <Markdown text={viewing.content} />
          </div>
        </div>
      )}

      {importOpen && (
        <div className="skill-view-overlay" data-testid="skills-import-dialog" onClick={() => setImportOpen(false)}>
          <div className="skill-view-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="skill-view-header">
              <strong>{t('skills.importTitle')}</strong>
              <button className="pill" data-testid="skills-import-cancel" onClick={() => setImportOpen(false)}>
                {t('skills.close')}
              </button>
            </div>
            <p className="hint">{t('skills.importHint')}</p>
            {!importData ? (
              <p className="hint">{t('states.loading')}</p>
            ) : (
              <>
                {importData.sources.every((s) => s.skills.length === 0) && (
                  <p className="hint" data-testid="skills-import-empty">{t('skills.importEmpty')}</p>
                )}
                {importData.sources.filter((s) => s.skills.length > 0).map((source) => (
                  <div className="skill-import-source" key={`${source.id}:${source.dir}`}>
                    <p className="skill-import-source-dir hint" title={source.dir}>{source.dir}</p>
                    {source.skills.map((skill) => {
                      const key = selectionKey(source.id, skill.name);
                      const selected = Boolean(selections[key]);
                      return (
                        <div className="skill-import-row" data-testid={`skill-import-row-${skill.name}`} key={key}>
                          <label>
                            <input
                              type="checkbox"
                              data-testid={`skill-import-check-${skill.name}`}
                              checked={selected}
                              disabled={skill.status === 'same'}
                              onChange={() => toggleSelection(source.id, skill)}
                            />
                            <span className="skill-name">{skill.name}</span>
                          </label>
                          <span className={`skill-source-badge import-${skill.status}`} data-testid={`skill-import-status-${skill.name}`}>
                            {t(`skills.status${skill.status === 'new' ? 'New' : skill.status === 'same' ? 'Same' : 'Conflict'}`)}
                          </span>
                          {selected && skill.status === 'conflict' && (
                            <select
                              data-testid={`skill-import-strategy-${skill.name}`}
                              value={selections[key].strategy}
                              onChange={(e) => setStrategy(source.id, skill.name, e.target.value as PiSkillImportStrategy)}
                            >
                              <option value="skip">{t('skills.strategySkip')}</option>
                              <option value="overwrite">{t('skills.strategyOverwrite')}</option>
                              <option value="rename">{t('skills.strategyRename')}</option>
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
                <div className="skill-import-footer">
                  <button className="pill" data-testid="skills-import-pick-dir" onClick={() => void pickDirectory()}>
                    {t('skills.importPickDirectory')}
                  </button>
                  <button
                    className="primary"
                    data-testid="skills-import-confirm"
                    disabled={importBusy || selectedCount === 0}
                    onClick={() => void confirmImport()}
                  >
                    {t('skills.importConfirm')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
