import type { PiPackageRow } from '@shared/host-api/contract';

/**
 * 判断系统中是否已安装计划模式所需的社区扩展或已在会话中激活
 */
export function isPlanExtensionInstalled(
  packages: PiPackageRow[],
  activeInSession?: boolean,
  hasExtensionCommand?: boolean,
): boolean {
  if (activeInSession) return true;
  if (hasExtensionCommand) return true;
  return (packages ?? []).some(
    (pkg) =>
      pkg.name === '@narumitw/pi-plan-mode' ||
      /plan-mode|pi-plan|pi-modes/i.test(pkg.name) ||
      /plan-mode|pi-plan|pi-modes/i.test(pkg.source),
  );
}
