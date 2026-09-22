import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 8999;
const HOST = '0.0.0.0';
const PATCH_FILE = path.resolve('release/Pi.Desktop-1.4.4-patch.zip');
import { createHash } from 'node:crypto';
function getPatchHash() {
  return createHash('sha256').update(fs.readFileSync(PATCH_FILE)).digest('hex');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  console.log(`[MockServer] ${req.method} ${url.pathname}`);

  if (url.pathname === '/api/latest' || url.pathname.endsWith('/releases/latest')) {
    const host = req.headers.host || '127.0.0.1:8999';
    const data = {
      tag_name: 'v1.4.4',
      draft: false,
      prerelease: false,
      html_url: 'https://github.com/zth0828/pi-desktop/releases/tag/v1.4.4',
      body: [
        '### 📥 下载地址 (Download)',
        '',
        '#### 🪟 Windows (不支持 Win7)',
        `- **标准安装版**：[Windows 64位安装包](http://${host}/Pi.Desktop-Setup-1.4.4-x64.exe)`,
        '',
        '#### 🍏 macOS (macOS 11.0+)',
        `- **Apple M芯片**：[Apple M芯片 DMG](http://${host}/Pi.Desktop-1.4.4-arm64.dmg)`,
        '',
        '---',
        '',
        '### 核心特性与更新',
        '- **增量热更新在线体验**：自适应识别增量补丁，一键平滑重启应用',
        '- **优化弹窗布局与展示**：过滤应用内多余下载链接，直接呈现更新说明',
        '- **消除子进程黑框弹窗**：Windows/macOS 无缝后台静默替换',
      ].join('\n'),
      assets: [
        {
          name: 'Pi.Desktop-1.4.4-patch.zip',
          browser_download_url: `http://${host}/Pi.Desktop-1.4.4-patch.zip`,
        },
        {
          name: 'SHA256SUMS-windows.txt',
          browser_download_url: `http://${host}/SHA256SUMS-windows.txt`,
        },
        {
          name: 'SHA256SUMS-macOS.txt',
          browser_download_url: `http://${host}/SHA256SUMS-macOS.txt`,
        },
      ],
    };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
    return;
  }

  if (url.pathname.endsWith('/SHA256SUMS-windows.txt') || url.pathname.endsWith('/SHA256SUMS-macOS.txt')) {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end(`${getPatchHash()}  Pi.Desktop-1.4.4-patch.zip\n`);
    return;
  }

  if (url.pathname.endsWith('/Pi.Desktop-1.4.4-patch.zip')) {
    const stat = fs.statSync(PATCH_FILE);
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': stat.size,
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(PATCH_FILE).pipe(res);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`Mock release server listening on http://${HOST}:${PORT}`);
});
