// .gitignore 感知回退遍历单测：fd 不可用（离线首装、GitHub 限流/代理拦截）时，
// @ 补全候选仍须尊重 .gitignore，语义对齐 pi TUI（fd）。
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readIgnoreLevel, walkGitignoreAware } from '../../electron/utils/gitignore-walk';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'pi-desktop-gitignore-walk-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content = ''): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

async function collect(extra?: Parameters<typeof walkGitignoreAware>[4]): Promise<string[]> {
  const out: string[] = [];
  const rootLevel = await readIgnoreLevel(root, '', '');
  await walkGitignoreAware(root, '', out, rootLevel ? [rootLevel] : [], {
    maxFiles: 200,
    ...extra,
  });
  return out;
}

describe('walkGitignoreAware（fd 不可用时的 @ 补全回退）', () => {
  it('根 .gitignore 基础模式：忽略文件、目录子树剪枝、保留 .gitignore 自身', async () => {
    write('hello-e2e.txt');
    write('ignored-e2e.txt');
    write('build/out.js');
    write('build/.keep');
    write('src/app.ts');
    write('.gitignore', 'ignored-e2e.txt\nbuild/\n');
    const files = await collect();
    expect(files).toContain('hello-e2e.txt');
    expect(files).toContain('src/app.ts');
    expect(files).toContain('.gitignore');
    expect(files).not.toContain('ignored-e2e.txt');
    expect(files).not.toContain('build/out.js');
    expect(files).not.toContain('build/.keep');
  });

  it('非 git 仓库同样生效（回退路径宁可多过滤不漏）', async () => {
    write('a.txt');
    write('secret.log');
    write('.gitignore', '*.log\n');
    const files = await collect();
    expect(files).toEqual(['.gitignore', 'a.txt']);
  });

  it('锚定模式（/前缀）只匹配该 .gitignore 所在层', async () => {
    write('anchored.txt');
    write('sub/anchored.txt');
    write('.gitignore', '/anchored.txt\n');
    const files = await collect();
    expect(files).not.toContain('anchored.txt');
    expect(files).toContain('sub/anchored.txt');
  });

  it('嵌套 .gitignore：深层规则覆盖浅层（! 重新包含）', async () => {
    write('debug.log');
    write('sub/debug.log');
    write('sub/keep.txt');
    write('.gitignore', '*.log\n');
    write('sub/.gitignore', '!debug.log\n');
    const files = await collect();
    expect(files).not.toContain('debug.log'); // 根规则仍然生效
    expect(files).toContain('sub/debug.log'); // 深层 ! 覆盖浅层
    expect(files).toContain('sub/keep.txt');
  });

  it('嵌套 .gitignore 的规则锚定在自己的目录（不泄漏到兄弟目录）', async () => {
    write('sub/inner.md');
    write('sub/other.md');
    write('sibling/inner.md');
    write('sub/.gitignore', 'inner.md\n');
    const files = await collect();
    expect(files).not.toContain('sub/inner.md');
    expect(files).toContain('sub/other.md');
    expect(files).toContain('sibling/inner.md'); // 兄弟目录不受 sub/.gitignore 影响
  });

  it('被忽略目录子树不可重新包含（git 语义）', async () => {
    write('gen/out.txt');
    write('gen/.gitignore', '!out.txt\n'); // 目录已被根规则排除，内部取反无效
    write('.gitignore', 'gen/\n');
    const files = await collect();
    expect(files).not.toContain('gen/out.txt');
    expect(files).not.toContain('gen/.gitignore');
  });

  it('排除目录（node_modules/.git）始终跳过', async () => {
    write('node_modules/pkg/index.js');
    write('node_modules/.git/HEAD');
    write('app.ts');
    const files = await collect();
    expect(files).toEqual(['app.ts']);
  });

  it('目录模式命中兄弟层级同名目录同样剪枝', async () => {
    write('a/build/x.txt');
    write('b/build/y.txt');
    write('.gitignore', 'build/\n');
    const files = await collect();
    expect(files).toEqual(['.gitignore']);
  });
});
