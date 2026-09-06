export interface InlineFileToken {
  type: 'text' | 'file';
  text?: string;
  path?: string;
  name?: string;
}

/**
 * 将用户消息原文解析为文本片段与内联文件引用。
 * 支持：
 * 1. Pi 展开格式：<file name="/abs/path/file.ext">...</file>
 * 2. 经典 @ 引用：@file.ext 或 @"path with spaces.ext"
 * 3. 路径格式：@[/abs/path/file.ext]
 */
export function parseUserMessageTokens(rawText: string): InlineFileToken[] {
  // 1. 过滤 <attachments> 信封与 <skill> 块（它们由独立的卡片组件展示）
  const clean = rawText
    .replace(/<attachments>[\s\S]*?<\/attachments>\n?/g, '')
    .replace(/<skill\s+[^>]*>[\s\S]*?<\/skill>\n?/g, '');

  // 2. 将 <file name="path"> 替换为标准化占位标记，保留其在句子中的相对位置
  const withPlaceholders = clean.replace(
    /<file name="([^"]*)">\n?[\s\S]*?\n?<\/file>\n?/g,
    (_match, filePath) => `__PI_MENTION__:${filePath}__`,
  );

  // 3. 正则匹配：
  // - __PI_MENTION__:path__
  // - @[path]
  // - @"quoted path"
  // - @filename.ext 或 @dir/file.ext
  const mentionRegex =
    /(__PI_MENTION__:([^_]+)__)|@\[([^\]]+)\]|(?:^|\s)@("([^"\n]+)"|([a-zA-Z0-9_./\\-]+(?:\.[a-zA-Z0-9_-]+)+|[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_./\\-]+))/g;

  const tokens: InlineFileToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(withPlaceholders)) !== null) {
    const matchStart = match.index;
    const fullMatch = match[0];

    // 如果是通过 @ 开头的匹配，可能带有前置空白
    const isSpecialPlaceholder = Boolean(match[1]);
    const isBracketMention = Boolean(match[3]);
    const leadingWhitespace = isSpecialPlaceholder || isBracketMention ? '' : fullMatch.match(/^\s*/)?.[0] ?? '';
    const actualStart = matchStart + leadingWhitespace.length;

    if (actualStart > lastIndex) {
      tokens.push({
        type: 'text',
        text: withPlaceholders.slice(lastIndex, actualStart),
      });
    }

    const filePath = isSpecialPlaceholder
      ? match[2]
      : isBracketMention
        ? match[3]
        : match[5] !== undefined
          ? match[5]
          : match[6];

    const fileName = filePath.includes('/')
      ? filePath.split('/').pop() || filePath
      : filePath.includes('\\')
        ? filePath.split('\\').pop() || filePath
        : filePath;

    tokens.push({
      type: 'file',
      path: filePath,
      name: fileName,
    });

    lastIndex = matchStart + fullMatch.length;
  }

  if (lastIndex < withPlaceholders.length) {
    tokens.push({
      type: 'text',
      text: withPlaceholders.slice(lastIndex),
    });
  }

  return tokens;
}
