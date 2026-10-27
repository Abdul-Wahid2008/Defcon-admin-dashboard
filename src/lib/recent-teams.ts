'use client';

import { useEffect, useState } from 'react';

const KEY = 'defcon.recentTeams';
const EVENT = 'defcon:recent-teams';
const MAX = 6;

export interface RecentTeam { id: string; name: string }

/** Per-viewer convenience only (docs: browser storage never holds state that matters). Every access can fail. */
export function readRecentTeams(): RecentTeam[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((t): t is RecentTeam => !!t && typeof (t as RecentTeam).id === 'string' && typeof (t as RecentTeam).name === 'string').slice(0, MAX)
      : [];
  } catch {
    return [];
  }
}

export function pushRecentTeam(team: RecentTeam): void {
  try {
    const next = [team, ...readRecentTeams().filter(t => t.id !== team.id)].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // storage blocked or full: the list is a convenience, ignore
  }
}

export function useRecentTeams(): RecentTeam[] {
  const [teams, setTeams] = useState<RecentTeam[]>([]);
  useEffect(() => {
    const load = () => setTeams(readRecentTeams());
    load();
    window.addEventListener(EVENT, load);
    window.addEventListener('storage', load);
    return () => { window.removeEventListener(EVENT, load); window.removeEventListener('storage', load); };
  }, []);
  return teams;
}
