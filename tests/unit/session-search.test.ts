import { describe, expect, it } from 'vitest';
import { searchSessions, type SearchableSession } from '../../electron/services/session-search';

function session(overrides: Partial<SearchableSession>): SearchableSession {
  return {
    name: undefined,
    firstMessage: '',
    allMessagesText: '',
    modified: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('searchSessions', () => {
  it('searches names, first prompts, and later message content in relevance order', () => {
    const results = searchSessions([
      session({ name: 'A different title', firstMessage: 'welcome', allMessagesText: 'welcome later needle' }),
      session({ name: 'Needle in title', firstMessage: 'welcome', allMessagesText: 'welcome' }),
      session({ name: 'Prompt title', firstMessage: 'Needle in the first prompt', allMessagesText: 'Needle in the first prompt' }),
    ], 'NEEDLE');

    expect(results.map((result) => result.match)).toEqual(['name', 'firstMessage', 'message']);
    expect(results[2].snippet).toContain('needle');
  });

  it('returns no results for blank queries and respects the result limit', () => {
    const sessions = Array.from({ length: 4 }, (_, index) => session({
      name: `Needle ${index}`,
      firstMessage: 'prompt',
      allMessagesText: 'prompt',
    }));
    expect(searchSessions(sessions, '   ')).toEqual([]);
    expect(searchSessions(sessions, 'needle', 2)).toHaveLength(2);
  });
});
