import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function serviceFiles(dir: string, skipAdapter = true): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return skipAdapter && entry.name === 'pi-adapter' ? [] : serviceFiles(full, skipAdapter);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('Pi adapter architecture guard', () => {
  it('does not expose SDK escape hatches to domain services', () => {
    const violations: string[] = [];
    for (const file of serviceFiles(path.join(process.cwd(), 'electron/services'))) {
      const source = readFileSync(file, 'utf8');
      if (source.includes('@earendil-works/pi-coding-agent')) violations.push(`${file}: upstream import`);
      if (/\bloadPiSdk\b|\bactive\.sdk\b|\bruntime\.sdk\b|\badapterRuntime\.raw\b|\bruntime\.services\b/.test(source)) {
        violations.push(`${file}: escape hatch`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps adapter implementation as the only upstream boundary', () => {
    const adapterSource = serviceFiles(path.join(process.cwd(), 'electron/services/pi-adapter'), false)
      .map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(adapterSource).toContain('@earendil-works/pi-coding-agent');
  });
});
