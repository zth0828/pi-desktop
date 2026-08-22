import { describe, expect, it, vi } from 'vitest';
import {
  getImageSaveFilters,
  mimeToExtension,
  parseDataUrl,
  resolveImageData,
  suggestFileName,
} from '../../src/lib/image-preview';

describe('image-preview helpers', () => {
  describe('parseDataUrl', () => {
    it('parses standard data URLs correctly', () => {
      const parsed = parseDataUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ');
      expect(parsed).toEqual({
        mimeType: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ',
      });
    });

    it('parses data URLs with charset', () => {
      const parsed = parseDataUrl('data:image/svg+xml;charset=utf-8;base64,PHN2Zz48L3N2Zz4=');
      expect(parsed).toEqual({
        mimeType: 'image/svg+xml',
        data: 'PHN2Zz48L3N2Zz4=',
      });
    });

    it('returns null for non-data URLs', () => {
      expect(parseDataUrl('https://example.com/img.png')).toBeNull();
      expect(parseDataUrl('/path/to/img.png')).toBeNull();
      expect(parseDataUrl('')).toBeNull();
    });
  });

  describe('mimeToExtension', () => {
    it('maps common image MIME types to file extensions', () => {
      expect(mimeToExtension('image/png')).toBe('png');
      expect(mimeToExtension('image/jpeg')).toBe('jpg');
      expect(mimeToExtension('image/jpg')).toBe('jpg');
      expect(mimeToExtension('image/webp')).toBe('webp');
      expect(mimeToExtension('image/gif')).toBe('gif');
      expect(mimeToExtension('image/svg+xml')).toBe('svg');
      expect(mimeToExtension('image/bmp')).toBe('bmp');
      expect(mimeToExtension('image/x-icon')).toBe('ico');
      expect(mimeToExtension('image/vnd.microsoft.icon')).toBe('ico');
    });

    it('falls back to png for unknown MIME types', () => {
      expect(mimeToExtension('application/octet-stream')).toBe('png');
      expect(mimeToExtension('unknown/type')).toBe('png');
    });
  });

  describe('suggestFileName', () => {
    it('returns provided name if it has an extension', () => {
      expect(suggestFileName('screenshot.png', 'image/png')).toBe('screenshot.png');
      expect(suggestFileName('photo.jpeg', 'image/jpeg')).toBe('photo.jpeg');
      expect(suggestFileName('avatar.webp', 'image/webp')).toBe('avatar.webp');
    });

    it('appends extension if provided name lacks one', () => {
      expect(suggestFileName('my-drawing', 'image/png')).toBe('my-drawing.png');
      expect(suggestFileName('chart', 'image/jpeg')).toBe('chart.jpg');
    });

    it('defaults to image.<ext> if name is missing or empty', () => {
      expect(suggestFileName(undefined, 'image/png')).toBe('image.png');
      expect(suggestFileName('', 'image/jpeg')).toBe('image.jpg');
      expect(suggestFileName('   ', 'image/webp')).toBe('image.webp');
    });
  });

  describe('getImageSaveFilters', () => {
    it('returns filters matching the mime type', () => {
      const filters = getImageSaveFilters('image/png');
      expect(filters).toEqual([
        { name: 'PNG Image (*.png)', extensions: ['png'] },
        { name: 'All Files (*.*)', extensions: ['*'] },
      ]);
    });

    it('returns filters for jpeg', () => {
      const filters = getImageSaveFilters('image/jpeg');
      expect(filters).toEqual([
        { name: 'JPG Image (*.jpg)', extensions: ['jpg'] },
        { name: 'All Files (*.*)', extensions: ['*'] },
      ]);
    });
  });

  describe('resolveImageData', () => {
    it('extracts base64 data directly from data URL', async () => {
      const src = 'data:image/png;base64,YWJjMTIz';
      const result = await resolveImageData(src);
      expect(result).toEqual({ mimeType: 'image/png', data: 'YWJjMTIz' });
    });

    it('fetches remote/blob URLs and converts to base64', async () => {
      const mockBuffer = new Uint8Array([104, 101, 108, 108, 111]).buffer; // "hello"
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () => ({
        blob: async () => ({
          type: 'image/jpeg',
          arrayBuffer: async () => mockBuffer,
        }),
      })) as unknown as typeof fetch;

      try {
        const result = await resolveImageData('blob:http://localhost/12345');
        expect(result.mimeType).toBe('image/jpeg');
        expect(result.data).toBe(btoa('hello'));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
