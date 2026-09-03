import { describe, expect, it } from 'vitest';
import { computeNextHistoryState } from '../../src/pages/Chat/chat-input/useInputHistory';

describe('chat-input-history (输入框历史回溯状态机)', () => {
  const sampleHistory = ['first command', 'second command', 'third command'];

  it('当输入框为空且按下 ArrowUp 时，调出最新一条历史记录（index = 0）', () => {
    const res = computeNextHistoryState('up', {
      historyIndex: -1,
      value: '',
      history: sampleHistory,
    });
    expect(res.handled).toBe(true);
    expect(res.nextIndex).toBe(0);
    expect(res.nextValue).toBe('third command');
  });

  it('连续按 ArrowUp 回溯更早的历史，直到最旧一条停止', () => {
    // 0 -> 1
    const res1 = computeNextHistoryState('up', {
      historyIndex: 0,
      value: 'third command',
      history: sampleHistory,
    });
    expect(res1.handled).toBe(true);
    expect(res1.nextIndex).toBe(1);
    expect(res1.nextValue).toBe('second command');

    // 1 -> 2
    const res2 = computeNextHistoryState('up', {
      historyIndex: 1,
      value: 'second command',
      history: sampleHistory,
    });
    expect(res2.handled).toBe(true);
    expect(res2.nextIndex).toBe(2);
    expect(res2.nextValue).toBe('first command');

    // 已到达最旧一条（index 2），再次 ArrowUp 保持当前
    const res3 = computeNextHistoryState('up', {
      historyIndex: 2,
      value: 'first command',
      history: sampleHistory,
    });
    expect(res3.handled).toBe(true);
    expect(res3.nextIndex).toBe(2);
    expect(res3.nextValue).toBeUndefined();
  });

  it('在历史浏览态按 ArrowDown 向前回退，到达 index 0 后再按还原为空白', () => {
    // 2 -> 1
    const res1 = computeNextHistoryState('down', {
      historyIndex: 2,
      value: 'first command',
      history: sampleHistory,
    });
    expect(res1.handled).toBe(true);
    expect(res1.nextIndex).toBe(1);
    expect(res1.nextValue).toBe('second command');

    // 1 -> 0
    const res2 = computeNextHistoryState('down', {
      historyIndex: 1,
      value: 'second command',
      history: sampleHistory,
    });
    expect(res2.handled).toBe(true);
    expect(res2.nextIndex).toBe(0);
    expect(res2.nextValue).toBe('third command');

    // 0 -> -1，还原为空白
    const res3 = computeNextHistoryState('down', {
      historyIndex: 0,
      value: 'third command',
      history: sampleHistory,
    });
    expect(res3.handled).toBe(true);
    expect(res3.nextIndex).toBe(-1);
    expect(res3.nextValue).toBe('');
  });

  it('严格防误触：若输入框已有非空草稿且处于 -1 状态，绝对不拦截 ArrowUp，保持光标移动', () => {
    const res = computeNextHistoryState('up', {
      historyIndex: -1,
      value: 'editing some draft here',
      history: sampleHistory,
    });
    expect(res.handled).toBe(false);
    expect(res.nextIndex).toBe(-1);
  });

  it('严格防误触：若在草稿态且按下 ArrowDown，不拦截', () => {
    const res = computeNextHistoryState('down', {
      historyIndex: -1,
      value: '',
      history: sampleHistory,
    });
    expect(res.handled).toBe(false);
    expect(res.nextIndex).toBe(-1);
  });

  it('严格防误触：若斜杠菜单或文件提及弹窗打开中，不拦截 ArrowUp / ArrowDown', () => {
    const resSlash = computeNextHistoryState('up', {
      historyIndex: -1,
      value: '',
      history: sampleHistory,
      slashOpen: true,
    });
    expect(resSlash.handled).toBe(false);

    const resMention = computeNextHistoryState('up', {
      historyIndex: -1,
      value: '',
      history: sampleHistory,
      mentionOpen: true,
    });
    expect(resMention.handled).toBe(false);

    const resSlashDown = computeNextHistoryState('down', {
      historyIndex: 0,
      value: 'third command',
      history: sampleHistory,
      slashOpen: true,
    });
    expect(resSlashDown.handled).toBe(false);
  });

  it('当历史记录为空时，不拦截 ArrowUp', () => {
    const res = computeNextHistoryState('up', {
      historyIndex: -1,
      value: '',
      history: [],
    });
    expect(res.handled).toBe(false);
    expect(res.nextIndex).toBe(-1);
  });
});
