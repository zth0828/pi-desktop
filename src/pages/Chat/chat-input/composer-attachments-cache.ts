import type { StagedImage } from './types';

const MAX_CACHE_SIZE = 50;

/**
 * 内存缓存最近发送和排队的图片附件。
 * 键为图片附件名称（如 image.png、image-2.png），支持排队消息展示缩略图以及「取回编辑」时还原图片。
 */
class ComposerAttachmentsCache {
  private cache = new Map<string, StagedImage>();

  remember(images: StagedImage[]): void {
    for (const img of images) {
      if (!img.name) continue;
      // 保持 LRU 语义：重新设置排在最后
      this.cache.delete(img.name);
      this.cache.set(img.name, img);
      const basename = img.name.split(/[/\\]/).pop();
      if (basename && basename !== img.name) {
        this.cache.delete(basename);
        this.cache.set(basename, img);
      }
    }
    while (this.cache.size > MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      } else {
        break;
      }
    }
  }

  get(name: string): StagedImage | undefined {
    const direct = this.cache.get(name);
    if (direct) return direct;
    const basename = name.split(/[/\\]/).pop();
    return basename ? this.cache.get(basename) : undefined;
  }

  getPreviewUrl(name: string): string | undefined {
    return this.get(name)?.previewUrl;
  }

  clear(): void {
    this.cache.clear();
  }
}

export const composerAttachmentsCache = new ComposerAttachmentsCache();
