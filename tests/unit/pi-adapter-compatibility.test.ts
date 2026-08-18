import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCompatibilityReport,
  detectPiCapabilities,
} from '@electron/services/pi-adapter';
import type { PiSdk } from '@electron/services/pi-adapter';
import {
  FALLBACK_PI_VERSION,
  MIN_PI_VERSION,
  TESTED_PI_RANGES,
  isPiVersionTested,
} from '@shared/pi-compat';

function completeModule(): PiSdk {
  return {
    createAgentSessionServices: () => {},
    createAgentSessionFromServices: () => {},
    createAgentSessionRuntime: () => {},
    SessionManager: class {},
    SettingsManager: class {},
    createEventBus: () => {},
  } as unknown as PiSdk;
}

describe('Pi Adapter compatibility report', () => {
  it('marks a complete future SDK as compatible-untested instead of blocking by version', () => {
    const sdk = completeModule();
    const report = buildCompatibilityReport({
      sdk,
      version: '0.85.0',
      packageRoot: '/tmp/pi',
      testedRange: false,
      meetsMinimum: true,
    });
    expect(report.status).toBe('compatible-untested');
    expect(report.missingRequiredCapabilities).toEqual([]);
    expect(report.warnings.join(' ')).toContain('outside the tested range');
  });

  it('marks missing required public exports as incompatible', () => {
    const sdk = { createAgentSessionRuntime() {} } as unknown as PiSdk;
    const report = buildCompatibilityReport({
      sdk,
      version: '0.84.2',
      packageRoot: '/tmp/pi',
      testedRange: true,
      meetsMinimum: true,
    });
    expect(report.status).toBe('incompatible');
    expect(report.missingRequiredCapabilities).toContain('createAgentSessionServices');
    expect(report.missingRequiredCapabilities).toContain('SessionManager');
    expect(report.missingRequiredCapabilities).toContain('createEventBus');
  });

  it('detects the generic module capabilities without calling side-effecting methods', () => {
    expect(detectPiCapabilities(completeModule() as unknown as Record<string, unknown>)).toEqual({
      createAgentSessionServices: true,
      createAgentSessionFromServices: true,
      createAgentSessionRuntime: true,
      sessionManager: true,
      settingsManager: true,
      eventBus: true,
      prompt: true,
      subscribe: true,
      abort: true,
    });
  });

  it('keeps package.json compatibility metadata aligned with shared constants', () => {
    const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      piCompat: { min: string; tested: string[]; fallback: string };
    };
    expect(manifest.piCompat.min).toBe(MIN_PI_VERSION);
    expect(manifest.piCompat.tested).toEqual([...TESTED_PI_RANGES]);
    expect(manifest.piCompat.fallback).toBe(FALLBACK_PI_VERSION);
    expect(isPiVersionTested('0.83.0')).toBe(true);
    expect(isPiVersionTested('0.84.99')).toBe(true);
    expect(isPiVersionTested('0.85.0')).toBe(false);
  });
});
