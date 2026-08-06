import { describe, expect, it } from 'vitest';
import { compareSemver, gte, parseSemver } from '@electron/utils/semver';

describe('semver', () => {
  it('parses x.y.z with optional v prefix and prerelease', () => {
    expect(parseSemver('0.83.0')).toEqual({ major: 0, minor: 83, patch: 0, prerelease: '' });
    expect(parseSemver('v22.19.0')?.major).toBe(22);
    expect(parseSemver('1.0.0-beta.1')?.prerelease).toBe('beta.1');
    expect(parseSemver('not-a-version')).toBeNull();
    expect(parseSemver('1.2')).toBeNull();
  });

  it('compares versions', () => {
    expect(compareSemver('0.83.0', '0.83.0')).toBe(0);
    expect(compareSemver('0.82.1', '0.83.0')).toBe(-1);
    expect(compareSemver('0.83.1', '0.83.0')).toBe(1);
    expect(compareSemver('22.19.0', '22.19.0')).toBe(0);
    expect(compareSemver('24.14.0', '22.19.0')).toBe(1);
    expect(compareSemver('1.0.0-alpha', '1.0.0')).toBe(-1);
  });

  it('gte covers min-version checks', () => {
    expect(gte('0.83.0', '0.83.0')).toBe(true);
    expect(gte('0.82.9', '0.83.0')).toBe(false);
    expect(gte('22.19.0', '22.19.0')).toBe(true);
    expect(gte('22.18.9', '22.19.0')).toBe(false);
  });
});
