import { appendFileSync, mkdirSync } from 'node:fs';
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
  piVersion?: string;
  eventType?: string;
  durationMs?: number;
  errorName?: string;
  errorMessage?: string;
  stack?: string;
};

function diagnosticDirectory(): string {
  return process.env.PI_DESKTOP_USER_DATA_DIR
    ? path.join(process.env.PI_DESKTOP_USER_DATA_DIR, 'logs')
    : app.getPath('logs');
}

export function writePiDiagnostic(record: PiDiagnosticRecord): void {
  try {
    const directory = diagnosticDirectory();
    mkdirSync(directory, { recursive: true });
    appendFileSync(
      path.join(directory, 'pi-desktop.jsonl'),
      `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  } catch {
    // Diagnostics must never turn an existing runtime error into another failure.
  }
}

export function safeErrorFields(error: unknown): Pick<
  PiDiagnosticRecord,
  'errorName' | 'errorMessage' | 'stack'
> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack?.split('\n').slice(0, 12).join('\n'),
    };
  }
  return { errorMessage: String(error) };
}
