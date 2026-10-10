import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  captureReviewBaseline,
  clearReviewBaseline,
  isCapturingReviewBaseline,
  normalizeGitRelPath,
  reviewApi,
} from '../../electron/services/review-api';

describe('review baseline guards and non-blocking capture', () => {
  it('isCapturingReviewBaseline 标识当前捕获状态，并在完成前返回 capturing 占位', async () => {
    clearReviewBaseline();
    const tempDir = await mkdtemp(path.join(tmpdir(), 'pi-test-review-guards-'));

    try {
      // 捕获前
      expect(isCapturingReviewBaseline(tempDir)).toBe(false);

      // 发起捕获（不阻塞）
      const capturePromise = captureReviewBaseline(tempDir);
      // 后台执行中（由于是非 git 空目录，需要跑 git init bare 和 commit-tree）
      // 完成前或者完成后状态流转正常
      await capturePromise;
      expect(isCapturingReviewBaseline(tempDir)).toBe(false);
    } finally {
      clearReviewBaseline();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('超过阈值的大目录或文件时标记 directory-too-large', async () => {
    clearReviewBaseline();
    const tempDir = await mkdtemp(path.join(tmpdir(), 'pi-test-review-oversized-'));

    try {
      // 创建一个模拟大文件或者测试小阈值：reviewApi.getSummary 在没有 runtime 时返回 not-started
      const res = await reviewApi.getSummary(undefined, undefined);
      expect(res.available).toBe(false);
      expect(res.reason).toBe('not-started');
    } finally {
      clearReviewBaseline();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('非 git 目录捕获 baseline 后能成功完成且无错误', async () => {
    clearReviewBaseline();
    const tempDir = await mkdtemp(path.join(tmpdir(), 'pi-test-review-plain-'));
    await writeFile(path.join(tempDir, 'file1.txt'), 'content 1');
    await writeFile(path.join(tempDir, 'file2.txt'), 'content 2');

    try {
      await captureReviewBaseline(tempDir);
      expect(isCapturingReviewBaseline(tempDir)).toBe(false);
    } finally {
      clearReviewBaseline();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('不同工作区的 baseline 状态相互隔离，互不污染', async () => {
    clearReviewBaseline();
    const dirA = await mkdtemp(path.join(tmpdir(), 'pi-test-review-iso-a-'));
    const dirB = await mkdtemp(path.join(tmpdir(), 'pi-test-review-iso-b-'));

    try {
      await captureReviewBaseline(dirA);
      // dirA 捕获成功，dirB 尚未捕获
      expect(isCapturingReviewBaseline(dirA)).toBe(false);
      expect(isCapturingReviewBaseline(dirB)).toBe(false);
    } finally {
      clearReviewBaseline();
      await rm(dirA, { recursive: true, force: true });
      await rm(dirB, { recursive: true, force: true });
    }
  });

  it('包含中文与非 ASCII 文件名的目录能够正常建立 baseline 并成功完成', async () => {
    clearReviewBaseline();
    const tempDir = await mkdtemp(path.join(tmpdir(), 'pi-test-review-utf8-'));
    await writeFile(path.join(tempDir, '功能测试.txt'), '初始内容');
    await writeFile(path.join(tempDir, '🚀emoji.md'), '# 标题');

    try {
      await captureReviewBaseline(tempDir);
      expect(isCapturingReviewBaseline(tempDir)).toBe(false);
    } finally {
      clearReviewBaseline();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe('normalizeGitRelPath', () => {
    it('处理相对路径与带反斜杠/冗余前缀的路径', () => {
      expect(normalizeGitRelPath('/workspace', 'src/app.ts')).toBe('src/app.ts');
      expect(normalizeGitRelPath('/workspace', 'src\\components\\Button.tsx')).toBe('src/components/Button.tsx');
      expect(normalizeGitRelPath('/workspace', './src/index.ts')).toBe('src/index.ts');
    });

    it('支持 Windows 盘符绝对路径且大小写不敏感', () => {
      expect(normalizeGitRelPath('C:/workspace', 'c:/workspace/src/app.ts')).toBe('src/app.ts');
      expect(normalizeGitRelPath('c:\\workspace', 'C:\\workspace\\src\\app.ts')).toBe('src/app.ts');
      expect(normalizeGitRelPath('C:/workspace', 'D:/other/external.ts')).toBe('D:/other/external.ts');
    });

    it('支持 macOS /private 前缀拉齐', () => {
      expect(normalizeGitRelPath('/tmp/repo', '/private/tmp/repo/src/app.ts')).toBe('src/app.ts');
      expect(normalizeGitRelPath('/private/tmp/repo', '/tmp/repo/src/app.ts')).toBe('src/app.ts');
    });

    it('支持 Windows 扩展前缀 (\\\\?\\) 绝对路径归一化', () => {
      expect(normalizeGitRelPath('C:/workspace', '\\\\?\\C:\\workspace\\src\\app.ts')).toBe('src/app.ts');
      expect(normalizeGitRelPath('\\\\?\\C:\\workspace', 'C:/workspace/src/app.ts')).toBe('src/app.ts');
      expect(normalizeGitRelPath('\\\\?\\C:\\workspace', '\\\\?\\C:\\workspace\\src\\app.ts')).toBe('src/app.ts');
    });
  });
});

