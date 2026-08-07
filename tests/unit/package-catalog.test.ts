import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchPackageDetail,
  parsePackageCatalogHtml,
  parsePackageDetailHtml,
} from '../../electron/services/package-catalog';

const HTML = `
  <span class="packages-count">51-100 / 120</span>
  <article
    data-package-card="true"
    data-package-name="@demo/pi-tools"
    data-package-types="extension skill"
    data-package-downloads="12345"
    data-package-date="1720000000000"
  >
    <div class="packages-card-body">
      <h3 class="packages-name"><a href="/packages/@demo/pi-tools">@demo/pi-tools</a></h3>
      <p class="packages-desc">Tools &amp; skills for &lt;Pi&gt;.</p>
      <div class="packages-meta"><span>demo-author</span><span>12.3K/mo</span><span>2d ago</span></div>
      <div class="packages-badges">
        <span data-type="extension">extension</span>
        <span data-type="skill">skill</span>
      </div>
      <div class="packages-links">
        <a href="https://www.npmjs.com/package/@demo/pi-tools">npm</a>
        <a href="https://github.com/demo/pi-tools">repo</a>
        <a href="https://github.com/earendil-works/pi/issues/new?package-name=@demo/pi-tools">report</a>
      </div>
    </div>
  </article>
  <article
    data-package-card="true"
    data-package-name="plain-package"
    data-package-types=""
    data-package-downloads="10"
    data-package-date=""
  >
    <h3 class="packages-name"><a href="/packages/plain-package">plain-package</a></h3>
    <p class="packages-desc">Plain package</p>
    <div class="packages-meta"><span>plain-author</span><span>10/mo</span><span>today</span></div>
    <span data-type="package">package</span>
  </article>
  <a href="/packages?page=1">1</a>
  <span>2</span>
  <a href="/packages?page=3">3</a>
`;

describe('pi.dev package catalog parser', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PI_PACKAGE_CATALOG_URL;
    delete process.env.PI_PACKAGE_CATALOG_CACHE_DIR;
  });

  it('解析包字段、类型、链接与 HTML entity', () => {
    const result = parsePackageCatalogHtml(HTML, 'https://pi.dev/packages?page=2', 2);
    expect(result).toMatchObject({
      page: 2,
      totalPages: 3,
      totalCount: 120,
      start: 51,
      end: 100,
    });
    expect(result.packages[0]).toMatchObject({
      name: '@demo/pi-tools',
      description: 'Tools & skills for <Pi>.',
      author: 'demo-author',
      downloads: 12345,
      types: ['extension', 'skill'],
      detailsUrl: 'https://pi.dev/packages/@demo/pi-tools',
      npmUrl: 'https://www.npmjs.com/package/@demo/pi-tools',
      repositoryUrl: 'https://github.com/demo/pi-tools',
      publishedLabel: '2d ago',
    });
    expect(result.packages[0]?.publishedAt).toBe('2024-07-03T09:46:40.000Z');
  });

  it('没有 pi 类型时保留为普通 package，空日期不生成 ISO 时间', () => {
    const result = parsePackageCatalogHtml(HTML);
    expect(result.packages[1]).toMatchObject({
      name: 'plain-package',
      types: ['package'],
      publishedAt: undefined,
    });
  });

  it('解析详情页的元数据、manifest、README，并清洗危险标签', () => {
    const detail = parsePackageDetailHtml(`
      <header class="content-hero"><h1 class="content-title">@demo/pi-tools</h1><p class="content-description">A toolkit.</p></header>
      <div class="packages-detail-topline">
        <span class="packages-badge" data-type="extension">extension</span>
        <div class="packages-detail-links">
          <a href="https://www.npmjs.com/package/@demo/pi-tools">npm</a>
          <a href="https://github.com/demo/pi-tools">repo</a>
          <a href="https://github.com/demo/pi-tools">home</a>
          <a href="https://github.com/earendil-works/pi/issues/new?package-name=x">report</a>
        </div>
      </div>
      <div class="packages-install--detail"><code>$ pi install npm:@demo/pi-tools</code></div>
      <dl class="definition-grid"><dt>Version</dt><dd><code>1.2.3</code></dd><dt>License</dt><dd>MIT</dd><dt>Dependencies</dt><dd>2 dependencies · 1 peer</dd></dl>
      <pre class="raw-data-panel">{&amp;quot;extensions&amp;quot;:[&amp;quot;index.ts&amp;quot;]}</pre>
      <section class="packages-security-card"><p>Review before install.</p></section>
      <div class="packages-readme"><h2>Read me</h2><p>Hello <a href="javascript:alert(1)">world</a>.</p><script>alert(1)</script><pre><code>npm run test</code></pre></div>
    `, 'https://pi.dev/packages/@demo/pi-tools', '@demo/pi-tools');

    expect(detail).toMatchObject({
      name: '@demo/pi-tools',
      description: 'A toolkit.',
      version: '1.2.3',
      license: 'MIT',
      dependenciesLabel: '2 dependencies · 1 peer',
      types: ['extension'],
      installCommand: 'pi install npm:@demo/pi-tools',
      npmUrl: 'https://www.npmjs.com/package/@demo/pi-tools',
      repositoryUrl: 'https://github.com/demo/pi-tools',
      homepageUrl: 'https://github.com/demo/pi-tools',
      securityNote: 'Review before install.',
    });
    expect(detail.manifestJson).toContain('extensions');
    expect(detail.readmeHtml).toContain('<h2>Read me</h2>');
    expect(detail.readmeHtml).not.toContain('<script');
    expect(detail.readmeHtml).not.toContain('javascript:');
  });

  it('详情按包名缓存，TTL 内复用，refresh 显式绕过缓存', async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'pi-desktop-package-cache-'));
    process.env.PI_PACKAGE_CATALOG_CACHE_DIR = cacheDir;
    process.env.PI_PACKAGE_CATALOG_URL = 'https://pi.dev/packages';
    let requests = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      requests += 1;
      return new Response(`
        <header class="content-hero"><h1 class="content-title">@demo/pi-tools</h1><p class="content-description">Cached.</p></header>
        <div class="packages-detail-topline"><span data-type="extension">extension</span></div>
        <div class="packages-install--detail"><code>$ pi install npm:@demo/pi-tools</code></div>
        <dl class="definition-grid"><dt>Version</dt><dd>1.0.0</dd></dl>
      `, { status: 200, headers: { 'content-type': 'text/html' } });
    }));

    const first = await fetchPackageDetail({ name: '@demo/pi-tools' });
    const second = await fetchPackageDetail({ name: '@demo/pi-tools' });
    const third = await fetchPackageDetail({ name: '@demo/pi-tools', refresh: true });

    expect(first.cacheState).toBe('network');
    expect(second.cacheState).toBe('fresh');
    expect(third.cacheState).toBe('network');
    expect(requests).toBe(2);
    rmSync(cacheDir, { recursive: true, force: true });
  });
});
