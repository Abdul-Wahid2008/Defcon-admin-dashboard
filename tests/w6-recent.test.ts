// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pushRecentTeam, readRecentTeams } from '../src/lib/recent-teams';

afterEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); });

describe('recently opened teams (browser-local convenience)', () => {
  it('keeps the six most recent, newest first, without duplicates', () => {
    for (let i = 1; i <= 8; i++) pushRecentTeam({ id: `team-0${i}`, name: `T${i}` });
    pushRecentTeam({ id: 'team-05', name: 'T5' });
    expect(readRecentTeams().map(t => t.id)).toEqual(['team-05', 'team-08', 'team-07', 'team-06', 'team-04', 'team-03']);
  });

  it('survives corrupt or blocked storage', () => {
    window.localStorage.setItem('defcon.recentTeams', '{not json');
    expect(readRecentTeams()).toEqual([]);
    window.localStorage.setItem('defcon.recentTeams', JSON.stringify([{ id: 1 }, { id: 'team-01', name: 'A' }]));
    expect(readRecentTeams()).toEqual([{ id: 'team-01', name: 'A' }]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => pushRecentTeam({ id: 'team-02', name: 'B' })).not.toThrow();
  });
});
