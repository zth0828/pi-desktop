// 极简 semver：只处理 x.y.z（可选预发布后缀），pi/node 版本比较够用。
// 不引第三方依赖，避免壳自身的版本语义与库实现漂移。

export type Semver = { major: number; minor: number; patch: number; prerelease: string };

export function parseSemver(version: string): Semver | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? '',
  };
}

/** a < b → -1；a == b → 0；a > b → 1。预发布版本低于同号正式版。 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error(`Invalid semver: ${!pa ? a : b}`);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === '') return 1;
  if (pb.prerelease === '') return -1;
  return pa.prerelease < pb.prerelease ? -1 : 1;
}

export function gte(version: string, minimum: string): boolean {
  return compareSemver(version, minimum) >= 0;
}
