import { useCallback, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

export interface ComputeHistoryOptions {
  historyIndex: number;
  value: string;
  history: string[];
  slashOpen?: boolean;
  mentionOpen?: boolean;
}

export interface ComputeHistoryResult {
  handled: boolean;
  nextIndex: number;
  nextValue?: string;
}

/**
 * 历史回溯核心状态机计算函数（纯函数，便于单测与跨环境复用）。
 *
 * 严格防误触规则：
 * 1. 补全弹窗（slashOpen / mentionOpen）打开中不拦截；
 * 2. 输入框已有非空内容且处于草稿态（historyIndex === -1）时，绝对不拦截，保持原生光标移动；
 * 3. 仅当输入框完全为空（value.trim() === ''）或当前已在历史浏览态时响应 ArrowUp / ArrowDown；
 * 4. 翻到底部（index = -1）时还原为空白。
 */
export function computeNextHistoryState(
  action: 'up' | 'down',
  options: ComputeHistoryOptions,
): ComputeHistoryResult {
  const { historyIndex, value, history, slashOpen = false, mentionOpen = false } = options;

  if (slashOpen || mentionOpen) {
    return { handled: false, nextIndex: historyIndex };
  }

  const historyLength = history.length;
  if (historyLength === 0 && historyIndex === -1) {
    return { handled: false, nextIndex: -1 };
  }

  if (action === 'up') {
    // 若输入框已有非空内容且处于草稿态，绝对不拦截
    if (historyIndex === -1 && value.trim() !== '') {
      return { handled: false, nextIndex: -1 };
    }
    if (historyLength === 0) {
      return { handled: false, nextIndex: -1 };
    }
    if (historyIndex === -1) {
      // 首次按上键：进入最新一条历史记录（索引 0）
      const nextIndex = 0;
      const nextValue = history[historyLength - 1 - nextIndex];
      return { handled: true, nextIndex, nextValue };
    }
    if (historyIndex < historyLength - 1) {
      const nextIndex = historyIndex + 1;
      const nextValue = history[historyLength - 1 - nextIndex];
      return { handled: true, nextIndex, nextValue };
    }
    // 已到最旧一条，保持当前
    return { handled: true, nextIndex: historyIndex };
  }

  // action === 'down'
  if (historyIndex === -1) {
    return { handled: false, nextIndex: -1 };
  }

  if (historyIndex > 0) {
    const nextIndex = historyIndex - 1;
    const nextValue = history[historyLength - 1 - nextIndex];
    return { handled: true, nextIndex, nextValue };
  }

  // historyIndex === 0 按下键回到草稿态，还原为空白
  return { handled: true, nextIndex: -1, nextValue: '' };
}

export interface UseInputHistoryOptions {
  value: string;
  setValue: (next: string | ((current: string) => string)) => void;
  history: string[];
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  slashOpen?: boolean;
  mentionOpen?: boolean;
}

export function useInputHistory({
  value,
  setValue,
  history,
  textareaRef,
  slashOpen = false,
  mentionOpen = false,
}: UseInputHistoryOptions) {
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const isNavigatingRef = useRef(false);

  const resetHistory = useCallback(() => {
    setHistoryIndex(-1);
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
      if (e.nativeEvent.isComposing || e.keyCode === 229) return false;

      const action = e.key === 'ArrowUp' ? 'up' : 'down';
      const result = computeNextHistoryState(action, {
        historyIndex,
        value,
        history,
        slashOpen,
        mentionOpen,
      });

      if (!result.handled) return false;

      e.preventDefault();
      setHistoryIndex(result.nextIndex);

      if (result.nextValue !== undefined) {
        isNavigatingRef.current = true;
        setValue(result.nextValue);
        const targetLen = result.nextValue.length;
        const schedule =
          typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : (cb: () => void) => setTimeout(cb, 0);

        schedule(() => {
          const textarea = textareaRef?.current;
          if (textarea) {
            textarea.selectionStart = targetLen;
            textarea.selectionEnd = targetLen;
          }
          isNavigatingRef.current = false;
        });
      }

      return true;
    },
    [history, historyIndex, mentionOpen, setValue, slashOpen, textareaRef, value],
  );

  return {
    historyIndex,
    resetHistory,
    handleKeyDown,
    isNavigatingRef,
  };
}
