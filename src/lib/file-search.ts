// @ 文件补全的模糊匹配：子串/子序列打分（无第三方依赖）。
// 排序：文件名前缀命中 > 子串命中 > 子序列命中，同级按路径字典序。

function subsequenceIndexOf(haystack: string, needle: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i += 1;
    if (i >= needle.length) return true;
  }
  return needle.length === 0;
}

function score(path: string, query: string): number | null {
  if (!query) return 0;
  const p = path.toLowerCase();
  const q = query.toLowerCase();
  const name = p.slice(p.lastIndexOf('/') + 1);
  if (name.startsWith(q)) return 0;
  if (p.includes(q)) return 1;
  if (subsequenceIndexOf(p, q)) return 2;
  return null;
}

export function filterFiles(files: string[], query: string, limit = 8): string[] {
  return files
    .map((path) => ({ path, s: score(path, query) }))
    .filter((r): r is { path: string; s: number } => r.s !== null)
    .sort((a, b) => a.s - b.s || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((r) => r.path);
}
