import type {
  PiPackageCatalogQuery,
  PiPackageCatalogResult,
  PiPackageCatalogRow,
  PiPackageCatalogType,
} from '@shared/host-api/contract';

const DEFAULT_CATALOG_URL = 'https://pi.dev/packages';
const PAGE_SIZE = 50;
const VALID_TYPES = new Set(['extension', 'skill', 'theme', 'prompt']);
const VALID_SORTS = new Set(['downloads', 'recent', 'name']);

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

  const response = await fetch(url, {
    headers: { accept: 'text/html', 'user-agent': 'Pi Desktop' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Package catalog request failed (${response.status})`);
  }
  return parsePackageCatalogHtml(await response.text(), url.toString(), page);
}
