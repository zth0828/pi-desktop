import path from 'node:path';
import { realpathSync } from 'node:fs';

const PREVIEWABLE_TOOLS = new Set(['read', 'edit', 'write']);

/** Existing paths use their real filesystem identity (/tmp -> /private/tmp on macOS). */
export function normalizePreviewablePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  try {
    return realpathSync(resolved);
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
        return path.join(realpathSync(parent), ...suffix);
      } catch {
        // Keep walking toward the filesystem root.
      }
    }
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
    if (candidate.role !== 'assistant' || !Array.isArray(candidate.content)) continue;
    for (const block of candidate.content) {
      if (!block || typeof block !== 'object') continue;
      const toolCall = block as {
        type?: unknown;
        name?: unknown;
        arguments?: { path?: unknown; file_path?: unknown };
      };
      if (toolCall.type !== 'toolCall' || typeof toolCall.name !== 'string' || !PREVIEWABLE_TOOLS.has(toolCall.name)) continue;
      const requested = toolCall.arguments?.path ?? toolCall.arguments?.file_path;
      if (typeof requested !== 'string' || !path.isAbsolute(requested)) continue;
      const normalized = normalizePreviewablePath(requested);
      const relative = path.relative(root, normalized);
      const outside = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
      if (outside) files.add(normalized);
    }
  }
  return files;
}
