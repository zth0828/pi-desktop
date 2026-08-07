import { describe, expect, it } from 'vitest';
import { parsePackageCatalogHtml } from '../../electron/services/package-catalog';

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
});
