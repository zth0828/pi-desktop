import type { PiSessionSearchMatch } from '@shared/host-api/contract';

export type SearchableSession = {
  name?: string;
  firstMessage: string;
  allMessagesText: string;
  modified: Date;
};

export type SessionSearchHit<T extends SearchableSession> = {
  session: T;
  match: PiSessionSearchMatch;
  snippet: string;
  matchIndex: number;
};

const MATCH_PRIORITY: Record<PiSessionSearchMatch, number> = {
  name: 0,
  firstMessage: 1,
  message: 2,
};

function normalizedIndex(text: string | undefined, query: string): number {
  return text?.toLocaleLowerCase().indexOf(query) ?? -1;
}

function excerpt(text: string, matchIndex: number, queryLength: number): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= 180) return compact;

  const normalizedSource = text.toLocaleLowerCase();
  const prefix = normalizedSource.slice(0, matchIndex).replace(/\s+/g, ' ');
  const compactIndex = Math.min(prefix.length, compact.length);
  const start = Math.max(0, compactIndex - 70);
  const end = Math.min(compact.length, compactIndex + queryLength + 100);
  return `${start > 0 ? '…' : ''}${compact.slice(start, end).trim()}${end < compact.length ? '…' : ''}`;
}

export function searchSessions<T extends SearchableSession>(
  sessions: T[],
  rawQuery: string,
  limit = 50,
): Array<SessionSearchHit<T>> {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return [];

  const hits = sessions.flatMap((session): Array<SessionSearchHit<T>> => {
    const nameIndex = normalizedIndex(session.name, query);
    if (nameIndex >= 0) {
      return [{
        session,
        match: 'name',
        snippet: session.firstMessage.replace(/\s+/g, ' ').trim(),
        matchIndex: nameIndex,
      }];
    }

    const firstMessageIndex = normalizedIndex(session.firstMessage, query);
    if (firstMessageIndex >= 0) {
      return [{
        session,
        match: 'firstMessage',
        snippet: excerpt(session.firstMessage, firstMessageIndex, query.length),
        matchIndex: firstMessageIndex,
      }];
    }

    const messageIndex = normalizedIndex(session.allMessagesText, query);
    if (messageIndex >= 0) {
      return [{
        session,
        match: 'message',
        snippet: excerpt(session.allMessagesText, messageIndex, query.length),
        matchIndex: messageIndex,
      }];
    }
    return [];
  });

  return hits
    .sort((a, b) => (
      MATCH_PRIORITY[a.match] - MATCH_PRIORITY[b.match]
      || a.matchIndex - b.matchIndex
      || b.session.modified.getTime() - a.session.modified.getTime()
    ))
    .slice(0, Math.max(1, Math.min(limit, 100)));
}
