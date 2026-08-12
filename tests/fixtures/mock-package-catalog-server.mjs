import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const tarballPath = process.argv[2];
const tarball = tarballPath ? readFileSync(tarballPath) : null;

const testPackages = [
  {
    name: 'pi-desktop-catalog-fixture',
    description: 'Installable package used by the Pi Desktop catalog test.',
    author: 'pi-desktop',
    downloads: 4200,
    date: 1786000000000,
    types: ['extension'],
  },
  {
    name: 'pi-desktop-skill-fixture',
    description: 'A searchable skill package for testing catalog filters.',
    author: 'fixture-author',
    downloads: 900,
    date: 1785000000000,
    types: ['skill'],
  },
  {
    name: 'pi-desktop-theme-fixture',
    description: 'A theme package on the second catalog page.',
    author: 'fixture-author',
    downloads: 100,
    date: 1784000000000,
    types: ['theme'],
  },
];

const readmeDemoPackages = [
  {
    name: 'pi-mcp-adapter',
    description: 'Connect pi to Model Context Protocol servers and tools.',
    author: 'pi ecosystem',
    downloads: 12800,
    date: 1786000000000,
    types: ['extension'],
  },
  {
    name: 'pi-web-access',
    description: 'Add web search and page-reading tools to pi sessions.',
    author: 'pi ecosystem',
    downloads: 9400,
    date: 1785000000000,
    types: ['extension'],
  },
  {
    name: 'context-mode',
    description: 'A context-management extension for long-running coding sessions.',
    author: 'pi ecosystem',
    downloads: 6100,
    date: 1784000000000,
    types: ['extension'],
  },
];

const allPackages = process.env.PI_CATALOG_README_DEMO === '1'
  ? readmeDemoPackages
  : testPackages;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function renderCard(pkg) {
  const types = pkg.types.join(' ');
  const badges = pkg.types.map((type) => `<span data-type="${type}">${type}</span>`).join('');
  return `<article data-package-card="true" data-package-name="${pkg.name}" data-package-types="${types}" data-package-downloads="${pkg.downloads}" data-package-date="${pkg.date}">
    <h3 class="packages-name"><a href="/packages/${pkg.name}">${pkg.name}</a></h3>
    <p class="packages-desc">${escapeHtml(pkg.description)}</p>
    <div class="packages-meta"><span>${pkg.author}</span><span>${pkg.downloads}/mo</span><span>recently</span></div>
    <div class="packages-badges">${badges}</div>
    <div class="packages-links"><a href="https://www.npmjs.com/package/${pkg.name}">npm</a><a href="https://github.com/example/${pkg.name}">repo</a></div>
  </article>`;
}

function renderCatalog(url) {
  const name = (url.searchParams.get('name') ?? '').toLowerCase();
  const type = url.searchParams.get('type') ?? '';
  const sort = url.searchParams.get('sort') ?? 'downloads';
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  let packages = allPackages.filter((pkg) => (
    (!name || `${pkg.name} ${pkg.description} ${pkg.author}`.toLowerCase().includes(name))
    && (!type || pkg.types.includes(type))
  ));
  packages = packages.toSorted((a, b) => {
    if (sort === 'recent') return b.date - a.date;
    if (sort === 'name') return a.name.localeCompare(b.name);
    return b.downloads - a.downloads;
  });
  const pageSize = 2;
  const startIndex = (page - 1) * pageSize;
  const pageRows = packages.slice(startIndex, startIndex + pageSize);
  const start = pageRows.length ? startIndex + 1 : 0;
  const end = startIndex + pageRows.length;
  const totalPages = Math.max(1, Math.ceil(packages.length / pageSize));
  const pagination = Array.from({ length: totalPages }, (_, index) => {
    const number = index + 1;
    return number === page ? `<span>${number}</span>` : `<a href="/packages?page=${number}">${number}</a>`;
  }).join('');
  return `<!doctype html><html><body>
    <span class="packages-count">${start}-${end} / ${packages.length}</span>
    ${pageRows.map(renderCard).join('')}
    <nav>${pagination}</nav>
  </body></html>`;
}

function renderDetail(name) {
  const pkg = allPackages.find((item) => item.name === name) ?? allPackages[0];
  return `<!doctype html><html><body>
    <header class="content-hero"><h1 class="content-title">${pkg.name}</h1><p class="content-description">${escapeHtml(pkg.description)}</p></header>
    <div class="packages-detail-topline">
      ${pkg.types.map((type) => `<span class="packages-badge" data-type="${type}">${type}</span>`).join('')}
      <div class="packages-detail-links"><a href="https://www.npmjs.com/package/${pkg.name}">npm</a><a href="https://github.com/example/${pkg.name}">repo</a><a href="https://github.com/example/${pkg.name}">home</a></div>
    </div>
    <div class="packages-install--detail"><code>$ pi install npm:${pkg.name}</code></div>
    <dl class="definition-grid"><dt>Package</dt><dd><code>${pkg.name}</code></dd><dt>Version</dt><dd><code>1.0.0</code></dd><dt>Published</dt><dd>Jul 1, 2026</dd><dt>Downloads</dt><dd>${pkg.downloads}/mo</dd><dt>Author</dt><dd>${pkg.author}</dd><dt>License</dt><dd>MIT</dd><dt>Types</dt><dd>${pkg.types.join(', ')}</dd><dt>Dependencies</dt><dd>0 dependencies</dd></dl>
    <pre class="raw-data-panel">{&amp;quot;extensions&amp;quot;:[&amp;quot;index.ts&amp;quot;]}</pre>
    <section class="packages-security-card"><p>Review this package before installing.</p></section>
    <div class="packages-readme"><h2>${pkg.name}</h2><p>Fixture README with <strong>consistent</strong> package detail rendering.</p><pre><code>pi install npm:${pkg.name}</code></pre></div>
  </body></html>`;
}

const server = createServer((req, res) => {
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const url = new URL(req.url ?? '/', baseUrl);
  if (url.pathname === '/packages') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderCatalog(url));
    return;
  }
  if (url.pathname.startsWith('/packages/')) {
    const name = decodeURIComponent(url.pathname.slice('/packages/'.length));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderDetail(name));
    return;
  }
  if (url.pathname === '/pi-desktop-catalog-fixture') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      name: 'pi-desktop-catalog-fixture',
      'dist-tags': { latest: '1.0.0' },
      versions: {
        '1.0.0': {
          name: 'pi-desktop-catalog-fixture',
          version: '1.0.0',
          dist: {
            tarball: `${baseUrl}/pi-desktop-catalog-fixture/-/pi-desktop-catalog-fixture-1.0.0.tgz`,
          },
        },
      },
    }));
    return;
  }
  if (url.pathname === '/pi-desktop-catalog-fixture/-/pi-desktop-catalog-fixture-1.0.0.tgz') {
    if (!tarball) {
      res.writeHead(404);
      res.end('tarball unavailable');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': tarball.length });
    res.end(tarball);
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  process.stdout.write(`http://127.0.0.1:${address.port}\n`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
