import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type {
  PiPackageCatalogQuery,
  PiPackageDetail,
  PiPackageDetailQuery,
  PiPackageDetailResult,
  PiPackageCatalogResult,
  PiPackageCatalogRow,
  PiPackageCatalogType,
} from '@shared/host-api/contract';

const DEFAULT_CATALOG_URL = 'https://pi.dev/packages';
const PAGE_SIZE = 50;
const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
const DETAIL_CACHE_TTL_MS = 30 * 60 * 1000;
const VALID_TYPES = new Set(['extension', 'skill', 'theme', 'prompt']);
const VALID_SORTS = new Set(['downloads', 'recent', 'name']);

type CacheEnvelope<T> = { fetchedAt: number; value: T };

function cacheDirectory(): string {
  return process.env.PI_PACKAGE_CATALOG_CACHE_DIR
    ?? path.join(homedir(), '.pi-desktop', 'package-cache');
}

function cacheFile(prefix: string, key: string): string {
  const digest = createHash('sha256').update(key).digest('hex');
  return path.join(cacheDirectory(), `${prefix}-${digest}.json`);
}

async function readCache<T>(prefix: string, key: string): Promise<CacheEnvelope<T> | null> {
  try {
    const parsed = JSON.parse(await readFile(cacheFile(prefix, key), 'utf8')) as CacheEnvelope<T>;
    if (!parsed || typeof parsed.fetchedAt !== 'number' || !parsed.value) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache<T>(prefix: string, key: string, value: T, fetchedAt: number): Promise<void> {
  try {
    await mkdir(cacheDirectory(), { recursive: true });
    const target = cacheFile(prefix, key);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ fetchedAt, value }), 'utf8');
    await rename(temporary, target);
  } catch {
    // Caching is opportunistic; a read-only home directory must not break discovery.
  }
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const codePoint = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    if (body.startsWith('#')) {
      const codePoint = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return named[body.toLowerCase()] ?? entity;
  });
}

function textContent(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function innerByClass(html: string, tag: string, className: string): string | undefined {
  const match = html.match(
    new RegExp(`<${tag}\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'),
  );
  return match?.[1];
}

function attr(source: string, name: string): string | undefined {
  const match = source.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'));
  return match ? decodeHtml(match[1] ?? '') : undefined;
}

function absoluteUrl(baseUrl: string, value?: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function parseLinks(body: string, baseUrl: string): {
  detailsUrl: string;
  npmUrl?: string;
  repositoryUrl?: string;
} {
  const links = [...body.matchAll(/<a\b([^>]*)>/gi)]
    .map((match) => absoluteUrl(baseUrl, attr(match[1] ?? '', 'href')))
    .filter((url): url is string => Boolean(url));
  const detailsUrl = links.find((url) => {
    try {
      return new URL(url).pathname.startsWith('/packages/');
    } catch {
      return false;
    }
  }) ?? baseUrl;
  const npmUrl = links.find((url) => new URL(url).hostname === 'www.npmjs.com');
  const repositoryUrl = links.find((url) => {
    const parsed = new URL(url);
    return parsed.hostname !== 'www.npmjs.com'
      && !parsed.pathname.includes('/issues/new')
      && url !== detailsUrl;
  });
  return { detailsUrl, npmUrl, repositoryUrl };
}

function parseTypes(body: string, fallback?: string): PiPackageCatalogType[] {
  const types = [...body.matchAll(/data-type="([^"]+)"/gi)]
    .map((match) => decodeHtml(match[1] ?? ''))
    .filter((type): type is PiPackageCatalogType => (
      type === 'extension'
      || type === 'skill'
      || type === 'theme'
      || type === 'prompt'
      || type === 'package'
    ));
  if (types.length > 0) return [...new Set(types)];
  const fallbackTypes = (fallback ?? '').split(/\s+/).filter(Boolean);
  return fallbackTypes.length > 0
    ? fallbackTypes.filter((type): type is PiPackageCatalogType => VALID_TYPES.has(type))
    : ['package'];
}

export function parsePackageCatalogHtml(
  html: string,
  baseUrl = DEFAULT_CATALOG_URL,
  requestedPage = 1,
): PiPackageCatalogResult {
  const packages: PiPackageCatalogRow[] = [];
  const cardPattern = /<article\b([^>]*data-package-card="true"[^>]*)>([\s\S]*?)<\/article>/gi;
  for (const match of html.matchAll(cardPattern)) {
    const attributes = match[1] ?? '';
    const body = match[2] ?? '';
    const name = attr(attributes, 'data-package-name')?.trim();
    if (!name) continue;
    const descriptionMatch = body.match(/<p\b[^>]*class="[^"]*packages-desc[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const metaMatch = body.match(/<div\b[^>]*class="[^"]*packages-meta[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const meta = metaMatch
      ? [...(metaMatch[1] ?? '').matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)].map((item) => textContent(item[1] ?? ''))
      : [];
    const downloads = Number(attr(attributes, 'data-package-downloads') ?? 0);
    const publishedValue = attr(attributes, 'data-package-date')?.trim();
    const publishedMs = publishedValue ? Number(publishedValue) : Number.NaN;
    packages.push({
      name,
      description: textContent(descriptionMatch?.[1] ?? ''),
      author: meta[0] ?? '',
      downloads: Number.isFinite(downloads) ? downloads : 0,
      publishedAt: Number.isFinite(publishedMs) ? new Date(publishedMs).toISOString() : undefined,
      publishedLabel: meta[2] ?? '',
      types: parseTypes(body, attr(attributes, 'data-package-types')),
      ...parseLinks(body, baseUrl),
    });
  }

  const countText = textContent(
    html.match(/<[^>]*class="[^"]*packages-count[^"]*"[^>]*>([\s\S]*?)<\//i)?.[1] ?? '',
  );
  const countMatch = countText.match(/(\d[\d,]*)\s*-\s*(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
  const totalCount = Number((countMatch?.[3] ?? String(packages.length)).replaceAll(',', ''));
  const start = Number((countMatch?.[1] ?? (packages.length ? '1' : '0')).replaceAll(',', ''));
  const end = Number((countMatch?.[2] ?? String(packages.length)).replaceAll(',', ''));
  const linkedPages = [...html.matchAll(/[?&]page=(\d+)/g)].map((item) => Number(item[1]));
  const totalPages = Math.max(
    requestedPage,
    Math.ceil(totalCount / PAGE_SIZE),
    ...linkedPages.filter(Number.isFinite),
  );
  return {
    packages,
    page: Math.max(1, requestedPage),
    totalPages: Math.max(1, totalPages),
    totalCount: Number.isFinite(totalCount) ? totalCount : packages.length,
    start: Number.isFinite(start) ? start : 0,
    end: Number.isFinite(end) ? end : packages.length,
  };
}

function safePackageName(name: string): boolean {
  return /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name);
}

function detailUrlForName(name: string): string {
  const catalogUrl = new URL(process.env.PI_PACKAGE_CATALOG_URL ?? DEFAULT_CATALOG_URL);
  catalogUrl.pathname = `/packages/${encodeURIComponent(name)}`;
  catalogUrl.search = '';
  return catalogUrl.toString();
}

function sanitizeReadmeHtml(html: string): string {
  let sanitized = html
    .replace(/<(script|style|iframe|object|embed|form|base|svg|math)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|base|svg|math)\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  sanitized = sanitized.replace(
    /\s+(href|src)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (whole, attribute: string, quoted: string, doubleQuoted: string, singleQuoted: string, bare: string) => {
      const value = doubleQuoted ?? singleQuoted ?? bare ?? '';
      if (/^\s*(?:javascript|vbscript|data):/i.test(decodeHtml(value))) return '';
      const quote = quoted?.startsWith("'") ? "'" : '"';
      return ` ${attribute}=${quote}${value}${quote}`;
    },
  );
  return sanitized;
}

function parseDetailLinks(html: string, baseUrl: string): Pick<
  PiPackageDetail,
  'npmUrl' | 'repositoryUrl' | 'homepageUrl' | 'reportUrl'
> {
  const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({
      href: absoluteUrl(baseUrl, attr(match[1] ?? '', 'href')),
      label: textContent(match[2] ?? '').toLowerCase(),
    }))
    .filter((link): link is { href: string; label: string } => Boolean(link.href));
  const npmUrl = links.find((link) => {
    try { return new URL(link.href).hostname === 'www.npmjs.com'; } catch { return false; }
  })?.href;
  const reportUrl = links.find((link) => {
    try { return new URL(link.href).pathname.includes('/issues/new'); } catch { return false; }
  })?.href;
  const repositoryUrl = links.find((link) => link.label === 'repo')?.href;
  const homepageUrl = links.find((link) => link.label === 'home')?.href;
  return { npmUrl, repositoryUrl, homepageUrl, reportUrl };
}

function parseDetailDefinition(html: string): Record<string, string> {
  const block = innerByClass(html, 'dl', 'definition-grid') ?? '';
  const fields: Record<string, string> = {};
  for (const match of block.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) {
    const key = textContent(match[1] ?? '').toLowerCase();
    if (key) fields[key] = textContent(match[2] ?? '');
  }
  return fields;
}

function parseDetailTypes(html: string): PiPackageCatalogType[] {
  const types = [...html.matchAll(/data-type="([^\"]+)"/gi)]
    .map((match) => decodeHtml(match[1] ?? ''))
    .filter((type): type is PiPackageCatalogType => (
      type === 'extension' || type === 'skill' || type === 'theme' || type === 'prompt' || type === 'package'
    ));
  return [...new Set(types)];
}

export function parsePackageDetailHtml(html: string, detailsUrl: string, requestedName?: string): PiPackageDetail {
  const heroName = textContent(innerByClass(html, 'h1', 'content-title') ?? '');
  const name = heroName || requestedName || 'unknown-package';
  const fields = parseDetailDefinition(html);
  const detailBlock = innerByClass(html, 'div', 'packages-detail-topline') ?? html;
  const installBlock = innerByClass(html, 'div', 'packages-install--detail') ?? '';
  const installCode = installBlock.match(/<code\b[^>]*>([\s\S]*?)<\/code>/i)?.[1] ?? '';
  const published = fields.published;
  const publishedMs = published ? Date.parse(published) : Number.NaN;
  const manifest = textContent(innerByClass(html, 'pre', 'raw-data-panel') ?? '');
  const readmeBlock = innerByClass(html, 'div', 'packages-readme');
  const securityNote = textContent(
    (innerByClass(html, 'section', 'packages-security-card') ?? innerByClass(html, 'div', 'packages-security-card'))
      ?.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '',
  );
  return {
    name,
    description: textContent(innerByClass(html, 'p', 'content-description') ?? '')
      || textContent(innerByClass(detailBlock, 'p', 'packages-detail-description') ?? ''),
    version: fields.version,
    author: fields.author,
    license: fields.license,
    downloadsLabel: fields.downloads,
    publishedLabel: published,
    publishedAt: Number.isFinite(publishedMs) ? new Date(publishedMs).toISOString() : undefined,
    sizeLabel: fields.size,
    dependenciesLabel: fields.dependencies,
    types: parseDetailTypes(detailBlock),
    installCommand: textContent(installCode).replace(/^\$\s*/, ''),
    ...parseDetailLinks(detailBlock, detailsUrl),
    detailsUrl,
    manifestJson: manifest || undefined,
    readmeHtml: sanitizeReadmeHtml(readmeBlock ?? ''),
    securityNote: securityNote || undefined,
    fetchedAt: Date.now(),
    cacheState: 'network',
  };
}

export async function fetchPackageCatalog(query: PiPackageCatalogQuery): Promise<PiPackageCatalogResult> {
  const baseUrl = process.env.PI_PACKAGE_CATALOG_URL ?? DEFAULT_CATALOG_URL;
  const url = new URL(baseUrl);
  const name = query.name?.trim();
  const type = query.type && VALID_TYPES.has(query.type) ? query.type : '';
  const sort = query.sort && VALID_SORTS.has(query.sort) ? query.sort : 'downloads';
  const page = Number.isFinite(query.page) ? Math.max(1, Math.floor(query.page ?? 1)) : 1;
  if (name) url.searchParams.set('name', name);
  if (type) url.searchParams.set('type', type);
  if (sort !== 'downloads') url.searchParams.set('sort', sort);
  if (page > 1) url.searchParams.set('page', String(page));

  const cacheKey = url.toString();
  const cached = await readCache<PiPackageCatalogResult>('catalog', cacheKey);
  const now = Date.now();
  if (cached && !query.refresh && now - cached.fetchedAt < CATALOG_CACHE_TTL_MS) {
    return { ...cached.value, fetchedAt: cached.fetchedAt, cacheState: 'fresh' };
  }

  try {
    const response = await fetch(url, {
      headers: { accept: 'text/html', 'user-agent': 'Pi Desktop' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Package catalog request failed (${response.status})`);
    }
    const result = parsePackageCatalogHtml(await response.text(), url.toString(), page);
    const fetchedAt = Date.now();
    await writeCache('catalog', cacheKey, result, fetchedAt);
    return { ...result, fetchedAt, cacheState: 'network' };
  } catch (error) {
    if (cached) return { ...cached.value, fetchedAt: cached.fetchedAt, cacheState: 'stale' };
    throw error;
  }
}

export async function fetchPackageDetail(query: PiPackageDetailQuery): Promise<PiPackageDetailResult> {
  const name = query.name.trim();
  if (!safePackageName(name)) throw new Error('Invalid package name');
  const detailsUrl = detailUrlForName(name);
  const cached = await readCache<PiPackageDetail>('detail', name);
  const now = Date.now();
  if (cached && !query.refresh && now - cached.fetchedAt < DETAIL_CACHE_TTL_MS) {
    return { ...cached.value, fetchedAt: cached.fetchedAt, cacheState: 'fresh' };
  }

  try {
    const response = await fetch(detailsUrl, {
      headers: { accept: 'text/html', 'user-agent': 'Pi Desktop' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Package detail request failed (${response.status})`);
    const result = parsePackageDetailHtml(await response.text(), detailsUrl, name);
    const fetchedAt = Date.now();
    await writeCache('detail', name, result, fetchedAt);
    return { ...result, fetchedAt, cacheState: 'network' };
  } catch (error) {
    if (cached) return { ...cached.value, fetchedAt: cached.fetchedAt, cacheState: 'stale' };
    throw error;
  }
}
