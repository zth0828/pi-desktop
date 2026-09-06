import { useMemo, useRef, useLayoutEffect } from 'react';
import { parseUserMessageTokens } from '../chat-message/user-mentions-parser';

export interface ComposerBackdropProps {
  value: string;
  scrollTop: number;
  scrollLeft: number;
}

/**
 * 输入框智能徽章高亮层（ComposerBackdrop）
 * 位于 textarea 底层，与文字保持 1:1 像素级精确对齐。
 * 将文本中的 @file 识别并包裹为圆角胶囊背景徽章。
 */
export function ComposerBackdrop({ value, scrollTop, scrollLeft }: ComposerBackdropProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = scrollTop;
      containerRef.current.scrollLeft = scrollLeft;
    }
  }, [scrollTop, scrollLeft]);

  const tokens = useMemo(() => parseUserMessageTokens(value), [value]);

  // 若末尾有换行符，textarea 会多渲染出一行高度，此处补上换行保持高度同步
  const endsWithNewline = value.endsWith('\n');

  return (
    <div
      ref={containerRef}
      className="composer-backdrop"
      aria-hidden="true"
    >
      {tokens.map((token, index) => {
        if (token.type === 'text') {
          return (
            <span key={index} className="composer-backdrop-text">
              {token.text}
            </span>
          );
        }

        const raw = token.raw || (token.path?.includes(' ') ? `@"${token.path}"` : `@${token.path}`);
        return (
          <span
            key={index}
            className="composer-mention-capsule"
            data-mention={token.path}
          >
            <span className="composer-mention-capsule-bg">{raw}</span>
          </span>
        );
      })}
      {endsWithNewline && '\n'}
    </div>
  );
}
