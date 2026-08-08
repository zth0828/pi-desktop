/**
 * @ 文件引用的纯函数部分（renderer/main 共用；node fs 部分在 electron/utils/file-expand.ts）。
 * 展开格式照 pi CLI 的 file-processor（dist/cli/file-processor.js）：
 *   文本文件 → `<file name="${absolutePath}">\n${content}\n</file>\n`
 *   图片     → 转 ImageContent，文本侧留 `<file name="${absolutePath}"></file>\n`
 *   空文件   → 跳过
 * pi 未从公开入口导出 processFileArguments，这里按同一格式实现（GUI 无法沿用其
 * process.exit 错误语义，读失败/二进制/超大改为在 <file> 块内联提示）。
 */

/** pi file-processor 的文本块模板（name = 绝对路径；renderer 附件通道只能用文件名）。 */
export function formatFileBlock(name: string, content: string): string {
  return `<file name="${name}">\n${content}\n</file>\n`;
}

/** pi file-processor 的图片占位块（图片本体走 images 通道）。 */
export function formatImageBlock(name: string): string {
  return `<file name="${name}"></file>\n`;
}

/** 文本内联上限：超过后在 <file> 块内联提示而不是塞爆 prompt。 */
export const MAX_FILE_TEXT_BYTES = 1024 * 1024;

/** @token：text 中 `@path` / `@"quoted path"` 的出现位置与路径。 */
export type AtToken = {
  /** 完整 token（含 @ 与引号），用于替换 */
  raw: string;
  /** 解析出的路径（不含 @ / 引号） */
  path: string;
  start: number;
  end: number;
};

/**
 * 提取文本中的 @ 文件引用 token。规则对齐 pi-tui 编辑器：
 * `@` 前必须是行首或空白；路径为连续的 `非空白@` 字符，或 `@"..."` 引用形式。
 */
export function extractAtTokens(text: string): AtToken[] {
  const tokens: AtToken[] = [];
  // (?:^|\s) 后 @ 开头；@"..." 或 @<非空白非@>+
  const re = /(^|\s)@("([^"\n]*)"|[^\s@]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[1].length;
    const raw = m[2];
    const path = m[3] !== undefined ? m[3] : raw;
    tokens.push({ raw: `@${raw}`, path, start, end: start + raw.length + 1 });
  }
  return tokens;
}

/** 简单二进制嗅探：内容含 NUL 即视为二进制。 */
export function isProbablyBinary(text: string): boolean {
  return text.includes(String.fromCharCode(0));
}

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

/** 按扩展名判图片（pi 用魔数嗅探，壳从简；不支持的扩展返回 undefined 按文本处理）。 */
export function imageMediaTypeForPath(filePath: string): string | undefined {
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return undefined;
  return IMAGE_MEDIA_TYPES[filePath.slice(dot).toLowerCase()];
}
