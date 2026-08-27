import { stripAttachmentEnvelope } from '@shared/message-attachments';
import type { PiSessionRow } from '@shared/host-api/contract';

const TITLE_MAX = 60;

/** 列表标题：优先用户命名，否则取首条消息截断；都没有返回空串（调用方给兜底文案）。 */
export function sessionDisplayTitle(
  session: Pick<PiSessionRow, 'name' | 'firstMessage'>,
  max = TITLE_MAX,
): string {
  const source = stripAttachmentEnvelope(session.name ?? session.firstMessage).trim().replace(/\s+/g, ' ');
  if (source.length <= max) return source;
  return `${source.slice(0, max)}…`;
}

/** 相对时间（如 "3 minutes ago" / "3 分钟前"）；locale 取 i18n 当前语言。 */
export function formatRelativeTime(iso: string, now = Date.now(), locale = 'en'): string {
  const diffSec = Math.round((new Date(iso).getTime() - now) / 1000);
  const absSec = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (absSec < 60) return rtf.format(Math.trunc(diffSec / 10) * 10 || 0, 'seconds');
  const absMin = Math.floor(absSec / 60);
  if (absMin < 60) return rtf.format(Math.trunc(diffSec / 60), 'minutes');
  const absHour = Math.floor(absMin / 60);
  if (absHour < 24) return rtf.format(Math.trunc(diffSec / 3600), 'hours');
  return rtf.format(Math.trunc(diffSec / 86400), 'days');
}
