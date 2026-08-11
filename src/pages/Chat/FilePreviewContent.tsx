import { createCodePlugin, type HighlightResult } from '@streamdown/code';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Code2, Eye, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WorkspaceReadResult } from '@shared/host-api/contract';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { Markdown } from '../../components/Markdown';
import { hostApi } from '../../lib/host-api';

const MAX_SHEET_ROWS = 200;
const MAX_SHEET_COLUMNS = 50;
const sourceHighlighter = createCodePlugin({ themes: ['github-light', 'github-dark'] });

const SOURCE_LANGUAGES: Record<string, string> = {
  bash: 'bash', c: 'c', cc: 'cpp', cpp: 'cpp', cs: 'csharp', css: 'css',
  go: 'go', h: 'c', hpp: 'cpp', html: 'html', java: 'java', js: 'javascript',
  json: 'json', jsx: 'jsx', kt: 'kotlin', kts: 'kotlin', lua: 'lua', md: 'markdown',
  mdown: 'markdown', markdown: 'markdown', mdx: 'mdx', php: 'php', plist: 'xml',
  ps1: 'powershell', py: 'python', rb: 'ruby', rs: 'rust', scss: 'scss', sh: 'bash',
  sql: 'sql', swift: 'swift', toml: 'toml', ts: 'typescript', tsx: 'tsx',
  vue: 'vue', xml: 'xml', yaml: 'yaml', yml: 'yaml', zsh: 'bash',
};

type SourceToken = { content: string; htmlStyle?: CSSProperties };

function sourceLanguage(name: string): string {
  const base = name.toLowerCase();
  if (/^(dockerfile|containerfile)$/.test(base)) return 'dockerfile';
  if (/^(makefile|gnumakefile)$/.test(base)) return 'make';
  const extension = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '';
  return SOURCE_LANGUAGES[extension] ?? 'text';
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeBase64Buffer(data: string): ArrayBuffer {
  const bytes = decodeBase64(data);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function TextSourcePreview({ name, text, truncated, wrapLines }: { name: string; text: string; truncated: boolean; wrapLines: boolean }) {
  const { t } = useTranslation();
  const [highlighted, setHighlighted] = useState<HighlightResult | null>(null);
  useEffect(() => {
    let cancelled = false;
    setHighlighted(null);
    const language = sourceLanguage(name) as Parameters<typeof sourceHighlighter.highlight>[0]['language'];
    const apply = (result: HighlightResult) => { if (!cancelled) setHighlighted(result); };
    const immediate = sourceHighlighter.highlight({ code: text, language, themes: sourceHighlighter.getThemes() }, apply);
    if (immediate) apply(immediate);
    return () => { cancelled = true; };
  }, [name, text]);
  const plainLines: SourceToken[][] = text.split('\n').map((line) => [{ content: line }]);
  const lines = (highlighted?.tokens as SourceToken[][] | undefined) ?? plainLines;
  return (
    <div className={`workspace-text-preview${wrapLines ? ' wrap-lines' : ''}`} data-testid="workspace-text-preview" data-language={sourceLanguage(name)}>
      {truncated && <div className="workspace-truncated">{t('workspace.truncated')}</div>}
      <div className="workspace-code" role="presentation">
        {lines.map((line, index) => (
          <div className="workspace-code-line" key={index}>
            <span className="workspace-code-number">{index + 1}</span>
            <code>{line.length > 0 ? line.map((token, tokenIndex) => (
              <span className="workspace-code-token" style={token.htmlStyle} key={`${index}:${tokenIndex}`}>{token.content}</span>
            )) : ' '}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function MarkdownFilePreview({ result, wrapLines }: { result: WorkspaceReadResult; wrapLines: boolean }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  useEffect(() => setMode('preview'), [result.path]);
  return (
    <div className="workspace-rich-preview" data-testid="workspace-markdown-preview">
      <div className="workspace-preview-toolbar">
        <div className="workspace-view-toggle" role="group" aria-label={t('workspace.viewMode')}>
          <button className={mode === 'preview' ? 'active' : ''} title={t('workspace.preview')} onClick={() => setMode('preview')}><Eye size={14} />{t('workspace.preview')}</button>
          <button className={mode === 'source' ? 'active' : ''} title={t('workspace.source')} onClick={() => setMode('source')}><Code2 size={14} />{t('workspace.source')}</button>
        </div>
      </div>
      {mode === 'preview' ? (
        <article className="workspace-markdown-document">
          {result.truncated && <div className="workspace-truncated">{t('workspace.truncated')}</div>}
          <Markdown text={result.text ?? ''} />
        </article>
      ) : <TextSourcePreview name={result.name} text={result.text ?? ''} truncated={result.truncated} wrapLines={wrapLines} />}
    </div>
  );
}

function PdfPreview({ data }: { data: string }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<PDFDocumentProxy>(undefined);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.1);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<(typeof import('pdfjs-dist/legacy/build/pdf.mjs'))['getDocument']> | undefined;
    documentRef.current = undefined;
    setPageCount(0);
    setPageNumber(1);
    setError(undefined);
    const timeout = window.setTimeout(() => {
      if (!cancelled) setError('PDF loading timed out');
    }, 15_000);
    void import('pdfjs-dist/legacy/build/pdf.worker.mjs').then(async ({ WorkerMessageHandler }) => {
      // Electron loads the renderer over file://, where PDF.js module workers can
      // fail to establish their message channel. Its supported main-thread worker
      // handler uses the same parser without depending on that URL boundary.
      globalThis.pdfjsWorker = { WorkerMessageHandler };
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      if (cancelled) return;
      loadingTask = pdfjs.getDocument({ data: decodeBase64(data) });
      const loaded = await loadingTask.promise;
      if (!cancelled) {
        window.clearTimeout(timeout);
        documentRef.current = loaded;
        setPageCount(loaded.numPages);
      }
    }).catch((nextError) => {
      if (!cancelled) setError(nextError instanceof Error ? nextError.message : String(nextError));
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      if (loadingTask) void loadingTask.destroy();
      documentRef.current = undefined;
    };
  }, [data]);

  useEffect(() => {
    const documentProxy = documentRef.current;
    if (!documentProxy || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    void documentProxy.getPage(pageNumber).then((page) => {
      if (cancelled || !canvasRef.current) return;
      const viewport = page.getViewport({ scale });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const task = page.render({
        canvas,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      });
      renderTask = task;
      return task.promise;
    }).catch((nextError) => {
      if (!cancelled && (nextError as { name?: string }).name !== 'RenderingCancelledException') {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      }
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pageCount, pageNumber, scale]);

  if (error) return <div className="workspace-empty" data-preview-error={error} title={error}>{t('workspace.pdfFailed')}</div>;
  return (
    <div className="workspace-pdf-preview" data-testid="workspace-pdf-preview">
      <div className="workspace-preview-toolbar">
        <div className="workspace-pdf-pager">
          <button className="icon-button" disabled={!pageCount || pageNumber <= 1} title={t('workspace.previousPage')} onClick={() => setPageNumber((page) => Math.max(1, page - 1))}><ChevronLeft size={15} /></button>
          <span>{pageCount ? t('workspace.pageCount', { page: pageNumber, count: pageCount }) : t('workspace.loading')}</span>
          <button className="icon-button" disabled={!pageCount || pageNumber >= pageCount} title={t('workspace.nextPage')} onClick={() => setPageNumber((page) => Math.min(pageCount || page, page + 1))}><ChevronRight size={15} /></button>
        </div>
        <div className="workspace-pdf-zoom">
          <button className="icon-button" disabled={scale <= 0.6} title={t('workspace.zoomOut')} onClick={() => setScale((value) => Math.max(0.6, value - 0.15))}><ZoomOut size={15} /></button>
          <span>{Math.round(scale * 100)}%</span>
          <button className="icon-button" disabled={scale >= 2.5} title={t('workspace.zoomIn')} onClick={() => setScale((value) => Math.min(2.5, value + 0.15))}><ZoomIn size={15} /></button>
        </div>
      </div>
      <div className="workspace-pdf-canvas"><canvas ref={canvasRef} /></div>
    </div>
  );
}

function DocumentPreview({ data }: { data: string }) {
  const { t } = useTranslation();
  const [html, setHtml] = useState<string>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setHtml(undefined);
    setError(false);
    void Promise.all([import('mammoth'), import('dompurify')]).then(async ([mammoth, purifier]) => {
      const converted = await mammoth.convertToHtml({ arrayBuffer: decodeBase64Buffer(data) });
      const safe = purifier.default.sanitize(converted.value, { USE_PROFILES: { html: true } });
      if (!cancelled) setHtml(safe);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [data]);
  if (error) return <div className="workspace-empty">{t('workspace.documentFailed')}</div>;
  if (html === undefined) return <div className="workspace-empty">{t('workspace.loading')}</div>;
  return (
    <div className="workspace-document-preview" data-testid="workspace-document-preview">
      <article
        onClick={(event) => {
          const anchor = (event.target as Element).closest('a');
          const href = anchor?.getAttribute('href');
          if (!href) return;
          event.preventDefault();
          void hostApi.shell.openExternal(href);
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toLocaleString();
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function SpreadsheetPreview({ result }: { result: WorkspaceReadResult }) {
  const { t } = useTranslation();
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheet, setSheet] = useState('');
  const [rows, setRows] = useState<unknown[][]>();
  const [workbookRows, setWorkbookRows] = useState<Record<string, unknown[][]>>({});
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRows(undefined);
    setError(false);
    if (result.text !== undefined) {
      void import('papaparse').then((papa) => {
        const delimiter = result.name.toLowerCase().endsWith('.tsv') ? '\t' : '';
        const parsed = papa.default.parse<string[]>(result.text ?? '', { delimiter, skipEmptyLines: false });
        if (!cancelled) {
          setSheetNames([]);
          setSheet('');
          setWorkbookRows({});
          setRows(parsed.data);
        }
      }).catch(() => { if (!cancelled) setError(true); });
      return () => { cancelled = true; };
    }
    if (!result.data) return () => { cancelled = true; };
    void import('read-excel-file/browser').then(async (reader) => {
      const parsedSheets = await reader.default(decodeBase64Buffer(result.data!));
      const names = parsedSheets.map((entry) => entry.sheet);
      if (!cancelled) {
        setWorkbookRows(Object.fromEntries(parsedSheets.map((entry) => [entry.sheet, entry.data])));
        setSheetNames(names);
        setSheet((current) => names.includes(current) ? current : (names[0] ?? ''));
      }
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [result.data, result.name, result.text]);

  useEffect(() => {
    if (sheet) setRows(workbookRows[sheet]);
  }, [sheet, workbookRows]);

  if (error) return <div className="workspace-empty">{t('workspace.spreadsheetFailed')}</div>;
  const visibleRows = rows?.slice(0, MAX_SHEET_ROWS) ?? [];
  const columnCount = Math.min(MAX_SHEET_COLUMNS, visibleRows.reduce((maximum, row) => Math.max(maximum, row.length), 0));
  return (
    <div className="workspace-spreadsheet-preview" data-testid="workspace-spreadsheet-preview">
      {sheetNames.length > 0 && (
        <div className="workspace-sheet-tabs" role="tablist">
          {sheetNames.map((name) => <button role="tab" aria-selected={sheet === name} className={sheet === name ? 'active' : ''} key={name} onClick={() => setSheet(name)}>{name}</button>)}
        </div>
      )}
      {!rows ? <div className="workspace-empty">{t('workspace.loading')}</div> : rows.length === 0 ? <div className="workspace-empty">{t('workspace.emptySheet')}</div> : (
        <div className="workspace-sheet-scroll">
          <table>
            <thead><tr><th className="workspace-row-number" />{Array.from({ length: columnCount }, (_, index) => <th key={index}>{formatCell(visibleRows[0]?.[index])}</th>)}</tr></thead>
            <tbody>{visibleRows.slice(1).map((row, rowIndex) => <tr key={rowIndex}><th className="workspace-row-number">{rowIndex + 2}</th>{Array.from({ length: columnCount }, (_, columnIndex) => <td key={columnIndex}>{formatCell(row[columnIndex])}</td>)}</tr>)}</tbody>
          </table>
          {(rows.length > MAX_SHEET_ROWS || rows.some((row) => row.length > MAX_SHEET_COLUMNS)) && <div className="workspace-sheet-limit">{t('workspace.sheetLimited', { rows: MAX_SHEET_ROWS, columns: MAX_SHEET_COLUMNS })}</div>}
        </div>
      )}
    </div>
  );
}

export function FilePreviewContent({ result, wrapLines = true }: { result: WorkspaceReadResult; wrapLines?: boolean }) {
  const { t } = useTranslation();
  if (result.truncated && !result.data && !result.text) {
    return <div className="workspace-empty">{t('workspace.tooLarge', { size: result.size.toLocaleString() })}</div>;
  }
  if (result.kind === 'image' && result.data) {
    return <div className="workspace-image-preview" data-testid="workspace-image-preview"><img src={`data:${result.mimeType};base64,${result.data}`} alt={result.name} /></div>;
  }
  if (result.kind === 'markdown') return <MarkdownFilePreview result={result} wrapLines={wrapLines} />;
  if (result.kind === 'text') return <TextSourcePreview name={result.name} text={result.text ?? ''} truncated={result.truncated} wrapLines={wrapLines} />;
  if (result.kind === 'pdf' && result.data) return <PdfPreview data={result.data} />;
  if (result.kind === 'document' && result.data) return <DocumentPreview data={result.data} />;
  if (result.kind === 'spreadsheet') return <SpreadsheetPreview result={result} />;
  return <div className="workspace-empty">{t('workspace.binary', { size: result.size.toLocaleString() })}</div>;
}
