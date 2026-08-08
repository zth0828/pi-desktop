// @ 文件引用的展开（node/fs 侧）。格式照 pi file-processor（见 shared/file-references.ts 头注）。
// 差异：pi CLI 读失败直接 exit；壳内联提示块继续发送。文件不存在时保留 @path 原文
// （与 pi TUI 行为一致——TUI 只插入 @path 文本，不展开）。
import { readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  extractAtTokens,
  formatFileBlock,
  formatImageBlock,
  imageMediaTypeForPath,
  isProbablyBinary,
  MAX_FILE_TEXT_BYTES,
} from '@shared/file-references';

export type ExpandedImage = {
  type: 'image';
  data: string;
  mimeType: string;
};

export type ExpandResult = { text: string; images: ExpandedImage[] };

/** ~ 展开 + 相对 cwd 解析（pi resolveReadPath 的精简版，不含 macOS 截图文件名变体）。 */
function resolveRefPath(ref: string, cwd: string): string {
  const expanded = ref.startsWith('~') ? path.join(os.homedir(), ref.slice(1)) : ref;
  return path.resolve(cwd, expanded);
}

/** 展开单个 token → 替换文本 + 可能的图片。失败/二进制/超大 → 内联提示块。 */
async function expandToken(
  tokenPath: string,
  cwd: string,
): Promise<{ replacement: string; image?: ExpandedImage } | null> {
  const absolutePath = resolveRefPath(tokenPath, cwd);
  let stats;
  try {
    stats = await stat(absolutePath);
  } catch {
    return null; // 不存在：保留 @path 原文
  }
  if (!stats.isFile()) return { replacement: formatFileBlock(absolutePath, '[not a file]') };
  if (stats.size === 0) return { replacement: '' }; // pi：空文件跳过

  const mediaType = imageMediaTypeForPath(absolutePath);
  if (mediaType) {
    try {
      const content = await readFile(absolutePath);
      return {
        replacement: formatImageBlock(absolutePath),
        image: { type: 'image', data: content.toString('base64'), mimeType: mediaType },
      };
    } catch (err) {
      return { replacement: formatFileBlock(absolutePath, readError(err)) };
    }
  }

  if (stats.size > MAX_FILE_TEXT_BYTES) {
    return { replacement: formatFileBlock(absolutePath, `[file too large: ${stats.size} bytes, not included]`) };
  }
  try {
    const content = await readFile(absolutePath, 'utf-8');
    if (isProbablyBinary(content)) {
      return { replacement: formatFileBlock(absolutePath, '[binary file, not included]') };
    }
    return { replacement: formatFileBlock(absolutePath, content) };
  } catch (err) {
    return { replacement: formatFileBlock(absolutePath, readError(err)) };
  }
}

function readError(err: unknown): string {
  return `[could not read file: ${err instanceof Error ? err.message : String(err)}]`;
}

/** 把 text 里的 @path 就地展开为 <file> 块；图片收集到 images。 */
export async function expandFileReferences(text: string, cwd: string): Promise<ExpandResult> {
  const tokens = extractAtTokens(text);
  if (tokens.length === 0) return { text, images: [] };
  const images: ExpandedImage[] = [];
  let result = '';
  let cursor = 0;
  for (const token of tokens) {
    const expanded = await expandToken(token.path, cwd);
    if (!expanded) continue; // 保留原文
    result += text.slice(cursor, token.start) + expanded.replacement;
    cursor = token.end;
    if (expanded.image) images.push(expanded.image);
  }
  result += text.slice(cursor);
  return { text: result, images };
}
