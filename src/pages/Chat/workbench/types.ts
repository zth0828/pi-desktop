import type { ShellApplication } from '@shared/host-api/contract';

export type PendingRevert =
  | { kind: 'file'; path: string }
  | { kind: 'hunk'; path: string; patch: string };

export type WorkbenchTab = 'files' | 'review' | 'commands' | `file:${string}`;

export function getContainer(panelEl: HTMLElement | null): HTMLElement | null {
  return panelEl?.closest<HTMLElement>('.chat-page') ?? document.querySelector<HTMLElement>('.chat-page');
}

export function availablePanelSpace(panelEl?: HTMLElement | null): number {
  return getContainer(panelEl ?? null)?.clientWidth ?? window.innerWidth;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export const APPLICATION_PRIORITY = [
  /^cursor$/i,
  /^finder$/i,
  /^terminal$/i,
  /^ghostty$/i,
  /^visual studio code$/i,
  /^xcode$/i,
  /^android studio$/i,
  /^zed$/i,
  /sublime text/i,
  /^textedit$/i,
];

export function rankApplications(applications: ShellApplication[]): ShellApplication[] {
  const priority = (name: string) => {
    const index = APPLICATION_PRIORITY.findIndex((pattern) => pattern.test(name));
    return index < 0 ? APPLICATION_PRIORITY.length : index;
  };
  return [...applications].sort((a, b) => priority(a.name) - priority(b.name) || a.name.localeCompare(b.name));
}
