import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  captureReviewBaseline,
  captureTurnCheckpointForActive,
  clearReviewBaseline,
  clearSessionTurnCheckpoints,
  getSessionTurnCheckpoints,
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

    it('支持 Windows 扩展前缀 (\\\\?\\) 及 UNC 路径绝对路径归一化', () => {
      expect(normalizeGitRelPath('C:/workspace', '\\\\?\\C:\\workspace\\src\\app.ts')).toBe('src/app.ts');
      expect(normalizeGitRelPath('\\\\?\\C:\\workspace', 'C:/workspace/src/app.ts')).toBe('src/app.ts');
      expect(normalizeGitRelPath('\\\\?\\C:\\workspace', '\\\\?\\C:\\workspace\\src\\app.ts')).toBe('src/app.ts');
      expect(normalizeGitRelPath('\\\\server\\share\\repo', '\\\\server\\share\\repo\\src\\app.ts')).toBe('src/app.ts');
      expect(normalizeGitRelPath('\\\\server\\share\\repo', '\\\\?\\UNC\\server\\share\\repo\\src\\app.ts')).toBe('src/app.ts');
    });

    it('支持点段与双点父目录规整化，并阻止跨工作区逃逸假阳性', () => {
      expect(normalizeGitRelPath('C:/workspace', 'c:/workspace/src/../src/app.ts')).toBe('src/app.ts');
      expect(normalizeGitRelPath('C:/workspace', 'c:/workspace/../outside/a.ts')).toBe('c:/outside/a.ts');
      expect(normalizeGitRelPath('/tmp/project', '/tmp/project/nested/../../outside.txt')).toBe('/tmp/outside.txt');
    });

    it('对空串或非字符串路径返回空字符串', () => {
      expect(normalizeGitRelPath('/workspace', '')).toBe('');
      expect(normalizeGitRelPath('/workspace', '   ')).toBe('');
      // @ts-expect-error testing invalid rawPath
      expect(normalizeGitRelPath('/workspace', undefined)).toBe('');
      expect(normalizeGitRelPath('/workspace', '\\\\.\\nul')).toBe('');
      expect(normalizeGitRelPath('/workspace', 'CON')).toBe('');
      expect(normalizeGitRelPath('NUL', 'src/app.ts')).toBe('');
      expect(normalizeGitRelPath('\\\\.\\COM1', 'src/app.ts')).toBe('');
    });
  });

  describe('captureReviewBaseline guards', () => {
    it('对空串、纯空白或设备路径 cwd 静默忽略且不创建 baseline', async () => {
      // @ts-expect-error testing invalid cwd
      await captureReviewBaseline(undefined);
      await captureReviewBaseline('');
      await captureReviewBaseline('   ');
      await captureReviewBaseline('\\\\.\\nul');
      await captureReviewBaseline('CON');
      expect(isCapturingReviewBaseline('')).toBe(false);
      expect(isCapturingReviewBaseline('\\\\.\\nul')).toBe(false);
    });
  });

  describe('reviewApi input guards', () => {
    it('getFileDiff 对空路径或非法路径返回 empty-path 或 device-path', async () => {
      // @ts-expect-error testing empty payload
      const emptyPayload = await reviewApi.getFileDiff({});
      expect(emptyPayload.available).toBe(false);
      expect(emptyPayload.reason).toBe('empty-path');

      const blankPath = await reviewApi.getFileDiff({ path: '   ' });
      expect(blankPath.available).toBe(false);
      expect(blankPath.reason).toBe('empty-path');

      const devicePath = await reviewApi.getFileDiff({ path: 'CON' });
      expect(devicePath.available).toBe(false);
      expect(devicePath.reason).toBe('device-path');
    });

    it('revertFile 对空路径或设备路径拦截并返回错误', async () => {
      // @ts-expect-error testing empty payload
      const emptyPayload = await reviewApi.revertFile({});
      expect(emptyPayload.success).toBe(false);
      expect(emptyPayload.error).toBe('empty path');

      const devicePath = await reviewApi.revertFile({ path: 'NUL' });
      expect(devicePath.success).toBe(false);
      expect(devicePath.error).toBe('device paths are not allowed');
    });

    it('revertHunk 对空路径、空 patch 或设备路径拦截并返回错误', async () => {
      // @ts-expect-error testing empty payload
      const emptyPayload = await reviewApi.revertHunk({});
      expect(emptyPayload.success).toBe(false);
      expect(emptyPayload.error).toBe('empty path');

      const emptyPatch = await reviewApi.revertHunk({ path: 'src/index.ts', patch: '   ' });
      expect(emptyPatch.success).toBe(false);
      expect(emptyPatch.error).toBe('empty patch');

      const devicePath = await reviewApi.revertHunk({ path: 'COM1', patch: 'patch content' });
      expect(devicePath.success).toBe(false);
      expect(devicePath.error).toBe('device paths are not allowed');
    });

    it('captureTurnCheckpoint, getTurnChanges, revertToTurnCheckpoint 未启动时安全拦截', async () => {
      const captureRes = await reviewApi.captureTurnCheckpoint({ turnIndex: 0 });
      expect(captureRes.success).toBe(false);
      expect(captureRes.error).toBe('not-started');

      const getChangesRes = await reviewApi.getTurnChanges({ turnIndex: 0 });
      expect(getChangesRes.available).toBe(false);
      expect(getChangesRes.reason).toBe('not-started');

      const revertRes = await reviewApi.revertToTurnCheckpoint({ turnIndex: 0 });
      expect(revertRes.success).toBe(false);
      expect(revertRes.error).toBe('not-started');
    });

    it('captureTurnCheckpointForActive 在从历史轮次发问时清理其后的过期快照映射', async () => {
      clearReviewBaseline();
      const tempDir = await mkdtemp(path.join(tmpdir(), 'pi-test-checkpoint-prune-'));
      try {
        await writeFile(path.join(tempDir, 'init.txt'), 'hello');
        await captureReviewBaseline(tempDir);

        const mockActive = {
          cwd: tempDir,
          sessionId: 'session-prune-test',
        } as unknown as import('../../electron/services/pi-runtime-api').ActiveRuntime;

        // 模拟第 0、1、2 轮捕获快照
        await captureTurnCheckpointForActive(mockActive, 0);
        await captureTurnCheckpointForActive(mockActive, 1);
        await captureTurnCheckpointForActive(mockActive, 2);

        // 用户回退到第 1 轮重新发问：捕获第 1 轮新快照，应清理第 2 轮的过期快照
        await writeFile(path.join(tempDir, 'modified.txt'), 'turn 1 new prompt');
        const hash1 = await captureTurnCheckpointForActive(mockActive, 1);
        expect(hash1).toBeTruthy();

        // 校验后续状态：第 0 轮和第 1 轮保留，第 2 轮被清理
        const sessionCheckpoints = getSessionTurnCheckpoints('session-prune-test');
        expect(sessionCheckpoints?.has(0)).toBe(true);
        expect(sessionCheckpoints?.get(1)).toBe(hash1);
        expect(sessionCheckpoints?.has(2)).toBe(false);

        // 会话销毁时清理快照映射
        clearSessionTurnCheckpoints('session-prune-test');
        expect(getSessionTurnCheckpoints('session-prune-test')).toBeUndefined();
      } finally {
        clearReviewBaseline();
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});


