import { describe, expect, it } from 'vitest';
import { formatPercent, formatTokenK, getContextPresetsForModel } from '../../src/pages/Chat/chat-input/types';

describe('Context Window Customization', () => {
  describe('formatPercent', () => {
    it('formats decimal percentages cleanly and consistently', () => {
      expect(formatPercent(8.5349)).toBe('8.5%');
      expect(formatPercent(8.5)).toBe('8.5%');
      expect(formatPercent(0.48)).toBe('0.5%');
      expect(formatPercent(12.34)).toBe('12.3%');
    });

    it('formats exact integer percentages without trailing zeroes', () => {
      expect(formatPercent(8.0)).toBe('8%');
      expect(formatPercent(10)).toBe('10%');
      expect(formatPercent(100)).toBe('100%');
      expect(formatPercent(0)).toBe('0%');
    });

    it('handles out of bounds and nullish values safely', () => {
      expect(formatPercent(null)).toBe('0%');
      expect(formatPercent(undefined)).toBe('0%');
      expect(formatPercent(-5)).toBe('0%');
      expect(formatPercent(120)).toBe('100%');
    });
  });

  describe('formatTokenK', () => {
    it('formats binary and decimal mega tokens appropriately', () => {
      expect(formatTokenK(1_048_576)).toBe('1M');
      expect(formatTokenK(2_097_152)).toBe('2M');
      expect(formatTokenK(1_000_000)).toBe('1M');
      expect(formatTokenK(1_500_000)).toBe('1.5M');
    });

    it('formats kilo tokens properly without decimal point', () => {
      expect(formatTokenK(500_000)).toBe('500k');
      expect(formatTokenK(272_000)).toBe('272k');
      expect(formatTokenK(256_000)).toBe('256k');
      expect(formatTokenK(200_000)).toBe('200k');
      expect(formatTokenK(128_000)).toBe('128k');
      expect(formatTokenK(64_000)).toBe('64k');
      expect(formatTokenK(32_000)).toBe('32k');
    });

    it('handles zero and nullish values safely', () => {
      expect(formatTokenK(0)).toBe('0');
      expect(formatTokenK(null)).toBe('0');
      expect(formatTokenK(undefined)).toBe('0');
      expect(formatTokenK(-100)).toBe('0');
    });
  });

  describe('getContextPresetsForModel', () => {
    it('generates high-capacity presets for 1M+ models (e.g. Gemini 2.5/3.0)', () => {
      const presets = getContextPresetsForModel(1_048_576);
      const values = presets.map((p) => p.value);
      expect(values).toContain(200_000);
      expect(values).toContain(256_000);
      expect(values).toContain(272_000);
      expect(values).toContain(400_000);
      expect(values).toContain(500_000);
      expect(values).toContain(1_048_576);

      const maxPreset = presets.find((p) => p.value === 1_048_576);
      expect(maxPreset?.label).toContain('Max');
    });

    it('generates tailored presets for 200k models (e.g. Claude 3.7 Sonnet)', () => {
      const presets = getContextPresetsForModel(200_000);
      const values = presets.map((p) => p.value);
      expect(values).toEqual([64_000, 128_000, 160_000, 200_000]);
      expect(presets[presets.length - 1].label).toBe('200k (Max)');
    });

    it('generates tailored presets for 128k models (e.g. GPT-4o, DeepSeek R1)', () => {
      const presets = getContextPresetsForModel(128_000);
      const values = presets.map((p) => p.value);
      expect(values).toEqual([32_000, 64_000, 96_000, 128_000]);
      expect(presets[presets.length - 1].label).toBe('128k (Max)');
    });

    it('generates appropriate presets for smaller models without exceeding maxContext', () => {
      const presets = getContextPresetsForModel(32_768);
      for (const p of presets) {
        expect(p.value).toBeLessThanOrEqual(32_768);
      }
      expect(presets.length).toBeGreaterThan(0);
      expect(presets[presets.length - 1].value).toBe(32_768);
    });

    it('does not contain duplicates', () => {
      const presets = getContextPresetsForModel(128_000);
      const values = presets.map((p) => p.value);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });
});
