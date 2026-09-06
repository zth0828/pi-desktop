import type { ReactNode } from 'react';
import { FileIcon } from '../../../components/FileIcon';
import { parseUserMessageTokens } from './user-mentions-parser';

export { parseUserMessageTokens, type InlineFileToken } from './user-mentions-parser';

/**
 * 渲染包含带图标文件胶囊的用户消息富文本组件
 */
export function renderUserMessageWithChips(
  rawText: string,
  onOpenFile?: (path: string) => void,
): ReactNode {
  const tokens = parseUserMessageTokens(rawText);

  if (tokens.length === 0) {
    return null;
  }

  return tokens.map((token, index) => {
    if (token.type === 'text') {
      return token.text;
    }

    const fileName = token.name || 'file';
    const filePath = token.path || fileName;

    return (
      <span
        key={`file-chip-${index}-${filePath}`}
        className="inline-file-chip"
        data-testid="inline-file-chip"
        title={filePath}
        onClick={onOpenFile ? () => onOpenFile(filePath) : undefined}
      >
        <FileIcon name={fileName} size={14} />
        <span className="inline-file-chip-name">{fileName}</span>
      </span>
    );
  });
}
