import path from 'node:path';
import { realpathSync } from 'node:fs';
import { stripWindowsExtendedPrefix } from './same-path';
import { isWindowsDevicePath } from './workspace-path';

const PREVIEWABLE_TOOLS = new Set(['read', 'edit', 'write']);

/** Existing paths use their real filesystem identity (/tmp -> /private/tmp on macOS). */
export function normalizePreviewablePath(filePath: string): string {
  if (!filePath || typeof filePath !== 'string' || !filePath.trim()) return '';
  const clean = stripWindowsExtendedPrefix(filePath.trim());
  if (isWindowsDevicePath(clean)) return clean;
  const resolved = path.resolve(clean);
  try {
    const real = realpathSync(resolved);
    return stripWindowsExtendedPrefix(real);
  } catch {
    // A write target may not exist yet. Resolve the nearest existing parent so
    // /tmp/new-file and /private/tmp/new-file still share one identity on macOS.
    const suffix: string[] = [];
    let parent = resolved;
    while (true) {
      const next = path.dirname(parent);
      if (next === parent) return resolved;
      suffix.unshift(path.basename(parent));
      parent = next;
      try {
        const realParent = realpathSync(parent);
        const joined = path.join(realParent, ...suffix);
        return stripWindowsExtendedPrefix(joined);
      } catch {
        // Keep walking toward the filesystem root.
      }
    }
  }
}

/**
 * 判定目标路径是否位于工作区内（处理 macOS /tmp 与 /private/tmp symlink 等跨平台等价形式）。
 */
export function isInsideWorkspace(root: string, candidate: string): boolean {
  if (!root || typeof root !== 'string' || !root.trim() || !candidate || typeof candidate !== 'string' || !candidate.trim()) {
    return false;
  }
  const cleanRoot = stripWindowsExtendedPrefix(root.trim());
  const cleanCandidate = stripWindowsExtendedPrefix(candidate.trim());
  if (isWindowsDevicePath(cleanRoot) || isWindowsDevicePath(cleanCandidate)) {
    return false;
  }
  try {
    const resolvedCandidate = path.isAbsolute(cleanCandidate) ? cleanCandidate : path.resolve(cleanRoot, cleanCandidate);
    const realRoot = normalizePreviewablePath(cleanRoot);
    const realCandidate = normalizePreviewablePath(resolvedCandidate);
    const relative = path.relative(realRoot, realCandidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  } catch {
    const resolvedCandidate = path.isAbsolute(cleanCandidate) ? cleanCandidate : path.resolve(cleanRoot, cleanCandidate);
    const relative = path.relative(cleanRoot, resolvedCandidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  }
}

/** Rebuild the external-file preview grant from pi's native historical messages (scoped to the last maxTurns turns). */
export function previewableExternalFilesFromMessages(
  messages: unknown[],
  cwd: string,
  maxTurns = 3,
): Set<string> {
  const root = normalizePreviewablePath(cwd);
  const files = new Set<string>();

  let userTurnsSeen = 0;
  const recentMessages: unknown[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    recentMessages.unshift(msg);
    if (msg && typeof msg === 'object' && (msg as { role?: unknown }).role === 'user') {
      userTurnsSeen++;
      if (userTurnsSeen >= maxTurns) {
        break;
      }
    }
  }

  for (const message of recentMessages) {
    if (!message || typeof message !== 'object') continue;
    const candidate = message as { role?: unknown; content?: unknown };
    if (candidate.role === 'user') {
      const texts: string[] = [];
      if (typeof candidate.content === 'string') {
        texts.push(candidate.content);
      } else if (Array.isArray(candidate.content)) {
        for (const block of candidate.content) {
          if (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
            texts.push((block as { text: string }).text);
          }
        }
      }
      for (const text of texts) {
        for (const match of text.matchAll(/<(?:file|attachment)\s+[^>]*name="([^"]*)"/g)) {
          const filePath = match[1];
          if (filePath && path.isAbsolute(filePath) && !isWindowsDevicePath(filePath)) {
            const normalized = normalizePreviewablePath(filePath);
            const relative = path.relative(root, normalized);
            const outside = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
            if (outside) files.add(normalized);
          }
        }
      }
    } else if (candidate.role === 'assistant' && Array.isArray(candidate.content)) {
      for (const block of candidate.content) {
        if (!block || typeof block !== 'object') continue;
        const toolCall = block as {
          type?: unknown;
          name?: unknown;
          arguments?: { path?: unknown; file_path?: unknown };
        };
        if (toolCall.type !== 'toolCall' || typeof toolCall.name !== 'string' || !PREVIEWABLE_TOOLS.has(toolCall.name)) continue;
        const requested = toolCall.arguments?.path ?? toolCall.arguments?.file_path;
        if (typeof requested !== 'string' || !path.isAbsolute(requested) || isWindowsDevicePath(requested)) continue;
        const normalized = normalizePreviewablePath(requested);
        const relative = path.relative(root, normalized);
        const outside = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
        if (outside) files.add(normalized);
      }
    }
  }
  return files;
}
