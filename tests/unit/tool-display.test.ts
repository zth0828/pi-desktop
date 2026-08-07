import { describe, expect, it } from 'vitest';
import {
  collectToolWarnings,
  extractResultText,
  formatDuration,
  parseDiffLines,
  resultDetails,
  tailLines,
  toolSummary,
} from '../../src/lib/tool-display';

describe('extractResultText', () => {
  it('拼接 content[].text，忽略 details', () => {
    const result = {
      content: [
        { type: 'text', text: 'line1' },
        { type: 'image', data: 'x' },
        { type: 'text', text: 'line2' },
      ],
      details: { diff: '+1 a' },
    };
    expect(extractResultText(result)).toBe('line1\nline2');
  });

  it('非对象/无 content 返回空串', () => {
    expect(extractResultText(undefined)).toBe('');
    expect(extractResultText('text')).toBe('');
    expect(extractResultText({ details: {} })).toBe('');
  });
});

describe('resultDetails', () => {
  it('提取 details 对象', () => {
    expect(resultDetails({ details: { diff: 'x' } })).toEqual({ diff: 'x' });
    expect(resultDetails({ details: undefined })).toBeUndefined();
    expect(resultDetails(null)).toBeUndefined();
    expect(resultDetails({ details: 'str' })).toBeUndefined();
  });
});

describe('toolSummary', () => {
  it('bash 显示 $ command', () => {
    expect(toolSummary('bash', { command: 'ls -la' })).toBe('$ ls -la');
  });

  it('edit/write/read 显示 path（兼容 file_path）', () => {
    expect(toolSummary('edit', { path: 'src/a.ts' })).toBe('src/a.ts');
    expect(toolSummary('write', { file_path: '/tmp/b.txt' })).toBe('/tmp/b.txt');
    expect(toolSummary('read', {})).toBeNull();
  });

  it('grep 显示 pattern，其他工具返回 null', () => {
    expect(toolSummary('grep', { pattern: 'foo.*bar' })).toBe('foo.*bar');
    expect(toolSummary('mcp', { tool: 'ping' })).toBeNull();
    expect(toolSummary('bash', undefined)).toBeNull();
    expect(toolSummary('bash', { command: '  ' })).toBeNull();
  });
});

describe('tailLines', () => {
  it('行数不超过 maxLines 时原样返回', () => {
    expect(tailLines('a\nb', 5)).toEqual({ lines: ['a', 'b'], hidden: 0 });
  });

  it('超过时只留尾部并给出裁掉行数', () => {
    expect(tailLines('1\n2\n3\n4\n5\n6\n7', 5)).toEqual({
      lines: ['3', '4', '5', '6', '7'],
      hidden: 2,
    });
  });

  it('空文本不裁', () => {
    expect(tailLines('', 5)).toEqual({ lines: [''], hidden: 0 });
  });
});

describe('parseDiffLines', () => {
  it('解析 +/-/上下文/省略行', () => {
    const diff = [' 1 ctx', '-2 old', '+2 new', '     ...'].join('\n');
    expect(parseDiffLines(diff)).toEqual([
      { kind: 'context', lineNum: '1', content: 'ctx' },
      { kind: 'del', lineNum: '2', content: 'old' },
      { kind: 'add', lineNum: '2', content: 'new' },
      { kind: 'skip', lineNum: '', content: '...' },
    ]);
  });

  it('行号宽度对齐的 diff 也能解析', () => {
    const diff = ['  9 keep', '-10 gone', '+10 here'].join('\n');
    const lines = parseDiffLines(diff);
    expect(lines[0]).toEqual({ kind: 'context', lineNum: '9', content: 'keep' });
    expect(lines[1]).toEqual({ kind: 'del', lineNum: '10', content: 'gone' });
    expect(lines[2]).toEqual({ kind: 'add', lineNum: '10', content: 'here' });
  });

  it('无法识别的行按 skip 处理', () => {
    expect(parseDiffLines('plain line')[0]).toEqual({ kind: 'skip', lineNum: '', content: 'plain line' });
  });
});

describe('formatDuration', () => {
  it('输出 X.Xs', () => {
    expect(formatDuration(1000, 4500)).toBe('3.5s');
    expect(formatDuration(0, 120)).toBe('0.1s');
  });

  it('缺时间戳或倒序时返回 null', () => {
    expect(formatDuration(undefined, 100)).toBeNull();
    expect(formatDuration(100, undefined)).toBeNull();
    expect(formatDuration(200, 100)).toBeNull();
  });
});

describe('collectToolWarnings', () => {
  it('bash：fullOutputPath + 按行截断', () => {
    const warnings = collectToolWarnings({
      fullOutputPath: '/tmp/out.log',
      truncation: { truncated: true, truncatedBy: 'lines', outputLines: 2000, totalLines: 5000 },
    });
    expect(warnings).toEqual([
      { kind: 'fullOutput', path: '/tmp/out.log' },
      { kind: 'truncatedLines', outputLines: 2000, totalLines: 5000 },
    ]);
  });

  it('bash：按字节截断', () => {
    expect(collectToolWarnings({ truncation: { truncated: true, truncatedBy: 'bytes', outputLines: 42 } })).toEqual([
      { kind: 'truncatedBytes', outputLines: 42 },
    ]);
  });

  it('grep：matchLimitReached / linesTruncated', () => {
    expect(collectToolWarnings({ matchLimitReached: 100, linesTruncated: true })).toEqual([
      { kind: 'matchLimit', limit: 100 },
      { kind: 'linesTruncated' },
    ]);
  });

  it('无 details 或无截断时为空', () => {
    expect(collectToolWarnings(undefined)).toEqual([]);
    expect(collectToolWarnings({ truncation: { truncated: false } })).toEqual([]);
  });
});
