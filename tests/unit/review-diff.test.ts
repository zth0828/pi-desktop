// review-diff 纯函数测试：unified diff 解析、单 hunk patch 重建（含真 git apply -R 回路）、
// 非 git 降级汇总（collectFallbackFiles）。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildHunkPatch,
  buildSplitDiffRows,
  collectFallbackFiles,
  mergeReviewFiles,
  normalizeDisplayPath,
  sessionChangeFiles,
  hunkLineKind,
  parseUnifiedDiff,
} from '@/lib/review-diff';

const SAMPLE_DIFF = `diff --git a/foo.txt b/foo.txt
index 1111111..2222222 100644
--- a/foo.txt
+++ b/foo.txt
@@ -1,3 +1,3 @@
 a
-b
+B
 c
@@ -10,3 +10,4 @@
 j
 k
+L
 l
`;

describe('parseUnifiedDiff', () => {
  it('解析头部与多个 hunk', () => {
    const parsed = parseUnifiedDiff(SAMPLE_DIFF);
    expect(parsed).not.toBeNull();
    expect(parsed!.headerLines).toEqual([
      'diff --git a/foo.txt b/foo.txt',
      'index 1111111..2222222 100644',
      '--- a/foo.txt',
      '+++ b/foo.txt',
    ]);
    expect(parsed!.hunks).toHaveLength(2);
    expect(parsed!.hunks[0].header).toBe('@@ -1,3 +1,3 @@');
    expect(parsed!.hunks[0].lines).toEqual([' a', '-b', '+B', ' c']);
    expect(parsed!.hunks[1].lines).toEqual([' j', ' k', '+L', ' l']);
  });

  it('空 diff / 无 hunk 返回 null', () => {
    expect(parseUnifiedDiff('')).toBeNull();
    expect(parseUnifiedDiff('diff --git a/f b/f\nold mode 100644\nnew mode 100755\n')).toBeNull();
  });

  it('保留 \\ No newline at end of file 标记行', () => {
    const diff = `diff --git a/f b/f
--- a/f
+++ b/f
@@ -1 +1 @@
-a
\\ No newline at end of file
+b
\\ No newline at end of file
`;
    const parsed = parseUnifiedDiff(diff);
    expect(parsed!.hunks[0].lines).toEqual([
      '-a',
      '\\ No newline at end of file',
      '+b',
      '\\ No newline at end of file',
    ]);
  });
});

describe('hunkLineKind', () => {
  it('按前缀分类', () => {
    expect(hunkLineKind('+x')).toBe('add');
    expect(hunkLineKind('-x')).toBe('del');
    expect(hunkLineKind(' x')).toBe('context');
    expect(hunkLineKind('\\ No newline at end of file')).toBe('marker');
  });
});

describe('buildSplitDiffRows', () => {
  it('pairs replacement lines and preserves both line number streams', () => {
    const parsed = parseUnifiedDiff(SAMPLE_DIFF)!;
    expect(buildSplitDiffRows(parsed.hunks[0])).toEqual([
      {
        old: { kind: 'context', lineNumber: 1, content: 'a' },
        next: { kind: 'context', lineNumber: 1, content: 'a' },
      },
      {
        old: { kind: 'del', lineNumber: 2, content: 'b' },
        next: { kind: 'add', lineNumber: 2, content: 'B' },
      },
      {
        old: { kind: 'context', lineNumber: 3, content: 'c' },
        next: { kind: 'context', lineNumber: 3, content: 'c' },
      },
    ]);
  });

  it('uses an empty cell when only one side has a line', () => {
    const parsed = parseUnifiedDiff(`diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -4,0 +4,1 @@\n+new\n`)!;
    expect(buildSplitDiffRows(parsed.hunks[0])[0]).toEqual({
      old: { kind: 'empty', lineNumber: null, content: '' },
      next: { kind: 'add', lineNumber: 4, content: 'new' },
    });
  });
});

describe('buildHunkPatch', () => {
  it('重建只含目标 hunk 的合法 patch（头部原样保留）', () => {
    const parsed = parseUnifiedDiff(SAMPLE_DIFF)!;
    const patch = buildHunkPatch(parsed, 1);
    expect(patch).toBe(`diff --git a/foo.txt b/foo.txt
index 1111111..2222222 100644
--- a/foo.txt
+++ b/foo.txt
@@ -10,3 +10,4 @@
 j
 k
+L
 l
`);
  });

  it('越界 hunk 抛错', () => {
    const parsed = parseUnifiedDiff(SAMPLE_DIFF)!;
    expect(() => buildHunkPatch(parsed, 2)).toThrow();
  });
});

// 真 git 回路：重建的单 hunk patch 必须能被 git apply -R 接受，且只回滚目标 hunk
describe('buildHunkPatch ↔ git apply -R 回路', () => {
  let dir: string;
  const git = (args: string[], input?: string) =>
    execFileSync('git', ['-C', dir, ...args], {
      input,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
    }).toString();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pi-desktop-review-diff-'));
    git(['init']);
    // 两个相距足够远的改动点 → 两个独立 hunk
    const base = Array.from({ length: 30 }, (_, i) => `line${i + 1}`).join('\n') + '\n';
    writeFileSync(join(dir, 'f.txt'), base);
    git(['add', 'f.txt']);
    git(['commit', '-m', 'init']);
    const cur = base.replace('line2', 'LINE2').replace('line29', 'LINE29');
    writeFileSync(join(dir, 'f.txt'), cur);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('只回滚第一个 hunk，第二个 hunk 的改动保留', () => {
    const diff = git(['diff', 'HEAD', '--', 'f.txt']);
    const parsed = parseUnifiedDiff(diff);
    expect(parsed).not.toBeNull();
    expect(parsed!.hunks.length).toBe(2);

    const patch = buildHunkPatch(parsed!, 0);
    git(['apply', '-R'], patch);

    const content = readFileSync(join(dir, 'f.txt'), 'utf-8');
    expect(content).toContain('line2'); // hunk 1 已回滚
    expect(content).toContain('LINE29'); // hunk 2 保留
  });
});

describe('collectFallbackFiles', () => {
  it('滤 edit/write 成功项，按路径去重并保留最后一次 diff', () => {
    const files = collectFallbackFiles({
      a: {
        toolName: 'edit',
        status: 'success',
        args: { path: 'x.txt' },
        result: { details: { diff: '-old\n+new' } },
      },
      b: { toolName: 'bash', status: 'success', args: { command: 'ls' } },
      c: { toolName: 'write', status: 'error', args: { path: 'y.txt' } },
      d: { toolName: 'write', status: 'success', args: { path: 'z.txt', content: 'hi' } },
      e: {
        toolName: 'edit',
        status: 'success',
        args: { path: 'x.txt' },
        result: { details: { diff: '-new\n+newer' } },
      },
    });
    expect(files.map((f) => f.path)).toEqual(['x.txt', 'z.txt']);
    expect(files[0].diff).toBe('-new\n+newer');
    expect(files[0]).toMatchObject({ added: 1, deleted: 1 });
    expect(files[1].diff).toBeUndefined();
    expect(files[1]).toMatchObject({ added: 1, deleted: 0 });
  });

  it('兼容 file_path 参数形态', () => {
    const files = collectFallbackFiles({
      a: { toolName: 'edit', status: 'success', args: { file_path: 'fp.txt' } },
    });
    expect(files.map((f) => f.path)).toEqual(['fp.txt']);
  });
});

describe('normalizeDisplayPath', () => {
  it('规范化相对路径与 ./ 前缀', () => {
    expect(normalizeDisplayPath('src/a.ts')).toBe('src/a.ts');
    expect(normalizeDisplayPath('./src/a.ts')).toBe('src/a.ts');
    expect(normalizeDisplayPath('src\\a.ts')).toBe('src/a.ts');
  });

  it('工作区内绝对路径转换为相对路径', () => {
    expect(normalizeDisplayPath('/workspace/src/a.ts', '/workspace')).toBe('src/a.ts');
    expect(normalizeDisplayPath('/workspace/src/a.ts', '/workspace/')).toBe('src/a.ts');
    expect(normalizeDisplayPath('C:\\workspace\\src\\a.ts', 'C:/workspace')).toBe('src/a.ts');
  });

  it('工作区外绝对路径保持原样', () => {
    expect(normalizeDisplayPath('/external/file.txt', '/workspace')).toBe('/external/file.txt');
  });
});

describe('sessionChangeFiles', () => {
  it('提取本会话 edit/write 文件并统计编辑次数与最新 diff', () => {
    const files = sessionChangeFiles({
      a: {
        toolName: 'edit',
        status: 'success',
        args: { path: '/workspace/src/index.ts' },
        result: { details: { diff: '-first\n+second' } },
      },
      b: { toolName: 'bash', status: 'success', args: { command: 'npm test' } },
      c: { toolName: 'edit', status: 'error', args: { path: '/workspace/src/failed.ts' } },
      d: {
        toolName: 'write',
        status: 'success',
        args: { path: '/workspace/src/new.ts', content: 'const a = 1;\nconst b = 2;\n' },
      },
      e: {
        toolName: 'edit',
        status: 'success',
        args: { path: '/workspace/src/index.ts' },
        result: { details: { diff: '-second\n+third\n+fourth' } },
      },
      f: {
        toolName: 'edit',
        status: 'success',
        args: { path: '/tmp/external.txt' },
        result: { details: { diff: '-old\n+new' } },
      },
    }, '/workspace');

    expect(files).toHaveLength(3);

    expect(files[0]).toEqual({
      path: '/tmp/external.txt',
      diff: '-old\n+new',
      added: 1,
      deleted: 1,
      editCount: 1,
    });

    expect(files[1]).toEqual({
      path: 'src/index.ts',
      diff: '-second\n+third\n+fourth',
      added: 2,
      deleted: 1,
      editCount: 2,
    });

    expect(files[2]).toEqual({
      path: 'src/new.ts',
      diff: undefined,
      added: 2,
      deleted: 0,
      editCount: 1,
    });
  });

  it('空记录或无修改工具时返回空数组', () => {
    expect(sessionChangeFiles({})).toEqual([]);
    expect(sessionChangeFiles({
      a: { toolName: 'read', status: 'success', args: { path: 'a.txt' } },
    })).toEqual([]);
  });
});

describe('mergeReviewFiles', () => {
  it('baseline 可用时只补工作区外的绝对路径', () => {
    const files = mergeReviewFiles('/workspace', true, [
      { path: 'inside.ts', status: 'modified', added: 2, deleted: 1 },
    ], [
      { path: 'inside.ts', added: 1, deleted: 1 },
      { path: '/workspace/absolute-inside.ts', added: 3, deleted: 0 },
      { path: '/another-project/external.ts', added: 4, deleted: 2 },
    ]);
    expect(files).toEqual([
      { path: 'inside.ts', status: 'modified', added: 2, deleted: 1 },
      { path: '/another-project/external.ts', status: 'modified', added: 4, deleted: 2 },
    ]);
  });

  it('baseline 不可用时保留全部工具文件并缩短工作区内绝对路径', () => {
    expect(mergeReviewFiles('/workspace', false, [], [
      { path: '/workspace/src/a.ts', added: 1, deleted: 0 },
      { path: '/other/b.ts', added: 2, deleted: 1 },
    ])).toEqual([
      { path: 'src/a.ts', status: 'modified', added: 1, deleted: 0 },
      { path: '/other/b.ts', status: 'modified', added: 2, deleted: 1 },
    ]);
  });
});
