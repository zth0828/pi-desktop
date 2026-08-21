import { open, stat } from 'node:fs/promises';

const ARCHIVE_CUSTOM_TYPE = 'pi-desktop.archive';
const DEFAULT_TAIL_SIZE = 8192;

export async function readSessionArchivedFlag(
  sessionPath: string,
  tailSize = DEFAULT_TAIL_SIZE,
): Promise<boolean> {
  let fileHandle;
  try {
    const fileStat = await stat(sessionPath);
    if (fileStat.size === 0) return false;

    const readLength = Math.min(fileStat.size, tailSize);
    const position = fileStat.size - readLength;
    fileHandle = await open(sessionPath, 'r');
    const buffer = Buffer.alloc(readLength);
    const { bytesRead } = await fileHandle.read(buffer, 0, readLength, position);
    if (bytesRead === 0) return false;

    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const lines = text.split('\n');

    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const entry = JSON.parse(line) as {
          type?: string;
          customType?: string;
          data?: { archived?: unknown };
        };
        if (entry.type === 'custom' && entry.customType === ARCHIVE_CUSTOM_TYPE) {
          return entry.data?.archived === true;
        }
      } catch {
        // Skip parse errors caused by truncated lines at the chunk boundary or uncompleted writes
        continue;
      }
    }
    return false;
  } catch {
    return false;
  } finally {
    await fileHandle?.close().catch(() => {});
  }
}
