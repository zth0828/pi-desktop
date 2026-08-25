import { describe, expect, it } from 'vitest';
import en from '@shared/i18n/locales/en/translation.json';
import zh from '@shared/i18n/locales/zh/translation.json';
import { PROVIDER_ERROR_HINT_KEYS } from '@shared/provider-error';

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    value !== null && typeof value === 'object'
      ? flattenKeys(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe('i18n parity（zh/en 双语 key 一致性）', () => {
  it('zh 与 en 的 key 集合完全一致', () => {
    const enKeys = flattenKeys(en).sort();
    const zhKeys = flattenKeys(zh).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it('无空文案', () => {
    for (const locale of [en, zh]) {
      for (const key of flattenKeys(locale)) {
        const value = key.split('.').reduce<unknown>(
          (acc, k) => (acc as Record<string, unknown>)[k],
          locale,
        );
        expect(typeof value === 'string' && value.trim().length > 0, `empty: ${key}`).toBe(true);
      }
    }
  });

  it('供应商错误 category 的 hint key 在双语里都存在（kebab/camel 漂移守卫）', () => {
    for (const [category, key] of Object.entries(PROVIDER_ERROR_HINT_KEYS)) {
      expect(zh.chat.errors, `zh chat.errors.${key} (${category})`).toHaveProperty(key);
      expect(en.chat.errors, `en chat.errors.${key} (${category})`).toHaveProperty(key);
    }
  });
});
