import { createHash } from 'node:crypto';
import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';

export type PiDiagnosticRecord = {
  level: 'info' | 'warning' | 'error';
  event: string;
  requestId?: string;
  module?: string;
  action?: string;
  sessionId?: string;
  generation?: number;
  adapterGeneration?: string;
  packageVersion?: string;
  /** Legacy field retained for existing call sites; sanitized and never contains secrets. */
  piVersion?: string;
  compatibilityStatus?: string;
  eventType?: string;
  promptPhase?: string;
  durationMs?: number;
  sessionPathHash?: string;
  errorName?: string;
  errorMessage?: string;
  stack?: string;
};

const MAX_BYTES = 1_000_000;
const queue: Promise<void>[] = [];
let writing = false;

function diagnosticDirectory(): string {
  return process.env.PI_DESKTOP_USER_DATA_DIR
    ? path.join(process.env.PI_DESKTOP_USER_DATA_DIR, 'logs')
    : app.getPath('logs');
}

function redact(value: string): string {
  return value
    .replace(/((?:api[_-]?key|authorization|bearer|x-api-key|token|secret|password)\s*[:=]\s*)([^\s,;"']+)/gi, '$1[REDACTED]')
    .replace(/([?&](?:api[_-]?key|token|secret|password|authorization)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
}

export function hashSessionPath(sessionPath: string): string {
  return createHash('sha256').update(sessionPath).digest('hex');
}

function sanitize(record: PiDiagnosticRecord): PiDiagnosticRecord {
  return {
    ...record,
    errorMessage: record.errorMessage ? redact(record.errorMessage).slice(0, 2000) : undefined,
    stack: record.stack ? redact(record.stack).slice(0, 6000) : undefined,
  };
}

async function rotate(file: string): Promise<void> {
  try {
    const info = await stat(file);
    if (info.size < MAX_BYTES) return;
    await rename(file, `${file}.1`).catch(() => undefined);
    await rename(`${file}.1`, `${file}.2`).catch(() => undefined);
  } catch {
    // A missing or concurrently rotated file is safe to recreate.
  }
}

async function drain(): Promise<void> {
  if (writing) return;
  writing = true;
  try {
    while (queue.length > 0) {
      const task = queue.shift();
      if (task) await task;
    }
  } finally {
    writing = false;
  }
}

export function writePiDiagnostic(record: PiDiagnosticRecord): void {
  const task = (async () => {
    try {
      const directory = diagnosticDirectory();
      await mkdir(directory, { recursive: true });
      const file = path.join(directory, 'pi-desktop.jsonl');
      await rotate(file);
      await appendFile(file, `${JSON.stringify({ at: new Date().toISOString(), ...sanitize(record) })}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch {
      // Diagnostics must never turn an existing runtime error into another failure.
    }
  })();
  queue.push(task);
  void drain();
}

export function safeErrorFields(error: unknown): Pick<PiDiagnosticRecord, 'errorName' | 'errorMessage' | 'stack'> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: redact(error.message),
      stack: error.stack?.split('\n').slice(0, 12).map(redact).join('\n'),
    };
  }
  return { errorMessage: redact(String(error)) };
}
