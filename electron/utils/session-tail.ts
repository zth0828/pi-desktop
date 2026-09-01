import { open, stat } from 'node:fs/promises';

export const ARCHIVE_CUSTOM_TYPE = 'pi-desktop.archive';
export const PIN_CUSTOM_TYPE = 'pi-desktop.pin';
const DEFAULT_TAIL_SIZE = 8192;

export type SessionMetadataFlags = {
  archived: boolean;
  pinned: boolean;
};

export async function readSessionMetadataFlags(
  sessionPath: string,
  tailSize = DEFAULT_TAIL_SIZE,
): Promise<SessionMetadataFlags> {
  let fileHandle;
  try {
    const fileStat = await stat(sessionPath);
    if (fileStat.size === 0) return { archived: false, pinned: false };

    const readLength = Math.min(fileStat.size, tailSize);
    const position = fileStat.size - readLength;
    fileHandle = await open(sessionPath, 'r');
    const buffer = Buffer.alloc(readLength);
    const { bytesRead } = await fileHandle.read(buffer, 0, readLength, position);
    if (bytesRead === 0) return { archived: false, pinned: false };

    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const lines = text.split('\n');

    let archived: boolean | undefined;
    let pinned: boolean | undefined;

    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const entry = JSON.parse(line) as {
          type?: string;
          customType?: string;
          data?: { archived?: unknown; pinned?: unknown };
        };
        if (entry.type === 'custom') {
          if (archived === undefined && entry.customType === ARCHIVE_CUSTOM_TYPE) {
            archived = entry.data?.archived === true;
          }
          if (pinned === undefined && entry.customType === PIN_CUSTOM_TYPE) {
            pinned = entry.data?.pinned === true;
          }
          if (archived !== undefined && pinned !== undefined) {
            break;
          }
        }
      } catch {
        // Skip parse errors caused by truncated lines at the chunk boundary or uncompleted writes
        continue;
      }
    }
    return {
      archived: archived ?? false,
      pinned: pinned ?? false,
    };
  } catch {
    return { archived: false, pinned: false };
  } finally {
    await fileHandle?.close().catch(() => {});
  }
}

export async function readSessionArchivedFlag(
  sessionPath: string,
  tailSize = DEFAULT_TAIL_SIZE,
): Promise<boolean> {
  const flags = await readSessionMetadataFlags(sessionPath, tailSize);
  return flags.archived;
}

export async function readSessionPinnedFlag(
  sessionPath: string,
  tailSize = DEFAULT_TAIL_SIZE,
): Promise<boolean> {
  const flags = await readSessionMetadataFlags(sessionPath, tailSize);
  return flags.pinned;
}
