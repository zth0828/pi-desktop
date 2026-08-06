import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PiSkillRow } from '@shared/host-api/contract';
import { hostApi } from '../lib/host-api';
import { useChatStore } from '../stores/chat';

export default function SkillsPage() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<PiSkillRow[]>([]);
  const [query, setQuery] = useState('');
  const [runtimeActive, setRuntimeActive] = useState(false);
  const [error, setError] = useState<string>();
  const chatStarted = useChatStore((s) => s.started);

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

  return (
    <div className="skills-page">
      <h2>{t('skills.title')}</h2>
      <p className="hint">{t('skills.readonlyHint')}</p>
      <input
        className="search-input"
        data-testid="skills-search"
        placeholder={t('list.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <p className="error-text" data-testid="skills-error">{error}</p>}
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
    </div>
  );
}
