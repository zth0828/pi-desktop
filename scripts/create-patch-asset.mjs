#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync } from 'fflate';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = process.env.PATCH_VERSION || pkg.version;

const candidates = [
  process.argv[2],
  resolve(root, 'release/mac-arm64/Pi Desktop.app/Contents/Resources/app.asar'),
  resolve(root, 'release/mac/Pi Desktop.app/Contents/Resources/app.asar'),
  resolve(root, 'release/win-unpacked/resources/app.asar'),
].filter(Boolean);

const asarPath = candidates.find((p) => existsSync(p));

if (!asarPath) {
  console.error('[create-patch-asset] Error: app.asar not found in candidate paths:', candidates);
  process.exit(1);
}

console.log(`[create-patch-asset] Reading app.asar from: ${asarPath}`);
const asarBuf = readFileSync(asarPath);
const asarHash = createHash('sha256').update(asarBuf).digest('hex');

const metadata = {
  version,
  target: 'app.asar',
  sha256: asarHash,
  sizeBytes: asarBuf.length,
  createdAt: new Date().toISOString(),
};

console.log(`[create-patch-asset] Compressing patch bundle for v${version} (${(asarBuf.length / 1024 / 1024).toFixed(2)} MB)...`);
const zipped = zipSync(
  {
    'app.asar': asarBuf,
    'patch-metadata.json': Buffer.from(JSON.stringify(metadata, null, 2)),
  },
  { level: 9 },
);

const outName = `Pi.Desktop-${version}-patch.zip`;
const outPath = resolve(root, 'release', outName);
writeFileSync(outPath, zipped);

const zipHash = createHash('sha256').update(zipped).digest('hex');
console.log(`[create-patch-asset] Successfully generated patch asset:`);
console.log(`  File:    ${outPath}`);
console.log(`  Size:    ${(zipped.length / 1024 / 1024).toFixed(2)} MB (${zipped.length} bytes)`);
console.log(`  SHA-256: ${zipHash}`);
