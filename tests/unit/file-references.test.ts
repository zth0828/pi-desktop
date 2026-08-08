// @ 文件引用单测：token 提取 / <file> 块格式（照 pi file-processor）/ Main 侧展开。
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  extractAtTokens,
  formatFileBlock,
  formatImageBlock,
  imageMediaTypeForPath,
  isProbablyBinary,
} from '../../shared/file-references';
import { expandFileReferences } from '../../electron/utils/file-expand';

describe('extractAtTokens', () => {
  it('提取空白/行首后的 @path', () => {
    const tokens = extractAtTokens('看看 @src/a.ts 和 @dir/b.md');
    expect(tokens.map((t) => t.path)).toEqual(['src/a.ts', 'dir/b.md']);
    expect(tokens[0].raw).toBe('@src/a.ts');
  });

  it('支持 @"quoted path" 形式', () => {
    const tokens = extractAtTokens('ref @"my dir/has space.txt" end');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].path).toBe('my dir/has space.txt');
    expect(tokens[0].raw).toBe('@"my dir/has space.txt"');
  });

  it('email 中的 @ 不算（前不是空白/行首）', () => {
    expect(extractAtTokens('mail me at a@b.com')).toHaveLength(0);
  });

  it('裸 @ 不成 token', () => {
    expect(extractAtTokens('hello @ world')).toHaveLength(0);
  });
});

describe('formatFileBlock（pi file-processor 格式）', () => {
  it('文本块：<file name="...">\\ncontent\\n</file>\\n', () => {
    expect(formatFileBlock('/abs/a.txt', 'hello')).toBe('<file name="/abs/a.txt">\nhello\n</file>\n');
  });
  it('图片占位块：空 <file name="..."></file>\\n', () => {
    expect(formatImageBlock('/abs/a.png')).toBe('<file name="/abs/a.png"></file>\n');
  });
});

describe('isProbablyBinary / imageMediaTypeForPath', () => {
  it('含 NUL 视为二进制', () => {
    expect(isProbablyBinary('ab\0c')).toBe(true);
    expect(isProbablyBinary('abc')).toBe(false);
  });
  it('常见图片扩展名', () => {
    expect(imageMediaTypeForPath('a/b.PNG')).toBe('image/png');
    expect(imageMediaTypeForPath('a.jpeg')).toBe('image/jpeg');
    expect(imageMediaTypeForPath('a.txt')).toBeUndefined();
    expect(imageMediaTypeForPath('noext')).toBeUndefined();
  });
});

describe('expandFileReferences', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pi-desktop-file-expand-'));
    writeFileSync(path.join(dir, 'hello.txt'), 'UNIQUE_HELLO_CONTENT');
    mkdirSync(path.join(dir, 'sub'));
    writeFileSync(path.join(dir, 'sub', 'note.md'), '# note');
    writeFileSync(path.join(dir, 'empty.txt'), '');
    writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02]));
    // 1x1 PNG
    writeFileSync(
      path.join(dir, 'pixel.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('文本文件就地展开为 <file> 块（name = 绝对路径）', async () => {
    const { text, images } = await expandFileReferences('解释 @hello.txt 的内容', dir);
    expect(text).toBe(`解释 <file name="${path.join(dir, 'hello.txt')}">\nUNIQUE_HELLO_CONTENT\n</file>\n 的内容`);
    expect(images).toHaveLength(0);
  });

  it('嵌套路径 + 原文无 token 不变', async () => {
    const { text } = await expandFileReferences('看 @sub/note.md', dir);
    expect(text).toContain('# note');
    const plain = await expandFileReferences('没有引用', dir);
    expect(plain.text).toBe('没有引用');
    expect(plain.images).toHaveLength(0);
  });

  it('图片转 images 通道 + 文本留占位块', async () => {
    const { text, images } = await expandFileReferences('@pixel.png', dir);
    expect(text).toBe(`<file name="${path.join(dir, 'pixel.png')}"></file>\n`);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(images[0].data.length).toBeGreaterThan(0);
  });

  it('空文件跳过（token 移除）', async () => {
    const { text } = await expandFileReferences('a @empty.txt b', dir);
    expect(text).toBe('a  b');
  });

  it('二进制文件内联提示块', async () => {
    const { text, images } = await expandFileReferences('@bin.dat', dir);
    expect(text).toContain('[binary file, not included]');
    expect(images).toHaveLength(0);
  });

  it('不存在的文件保留 @path 原文', async () => {
    const { text } = await expandFileReferences('看 @nope/missing.txt', dir);
    expect(text).toBe('看 @nope/missing.txt');
  });
});
