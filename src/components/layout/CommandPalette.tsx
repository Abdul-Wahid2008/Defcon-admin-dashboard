'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Activity, ClipboardList, History, LayoutDashboard, Settings, Siren, Users } from 'lucide-react';
import { apiListTeams, apiMeta } from '@/lib/api-client';
import { apiRunCheck } from '@/lib/api-admin';
import { useRecentTeams } from '@/lib/recent-teams';
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: 'Ctrl+K or Cmd+K', what: 'Open the command palette: jump to a team or page, run a check' },
  { keys: '/', what: 'Focus search (the teams search on the Teams page, otherwise the top-bar team search)' },
  { keys: '?', what: 'Show this list' },
  { keys: 'Enter / Space on a row', what: 'Open the focused team in the teams table or the matrix' },
  { keys: 'Esc', what: 'Close a dialog or the palette; focus returns to where it was' },
  { keys: 'Tab / Shift+Tab', what: 'Move between controls; the focus ring is always visible' },
];

function typing(): boolean {
  const el = document.activeElement as HTMLElement | null;
  const tag = (el?.tagName ?? '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || !!el?.isContentEditable;
}

export function CommandPalette({ role }: { role: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const recent = useRecentTeams();
  const qc = useQueryClient();
  const simulated = useQuery({ queryKey: ['meta'], queryFn: apiMeta, staleTime: 30_000 }).data?.sources.health === 'mock';
  // Loaded only while the palette is open; no background polling for it.
  const teams = useQuery({ queryKey: ['palette-teams'], queryFn: () => apiListTeams({ pageSize: 100 }), enabled: open, staleTime: 10_000 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      } else if (e.key === '?' && !typing() && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setHelp(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = useCallback((href: string) => { setOpen(false); router.push(href); }, [router]);

  const runCheck = useCallback(async (id: string) => {
    setOpen(false);
    try {
      const r = await apiRunCheck(id);
      toast(`${id}: ${simulated ? 'simulated check' : 'check'} finished, health ${r.health}`);
      void qc.invalidateQueries({ queryKey: ['overview'] });
      void qc.invalidateQueries({ queryKey: ['team', id] });
    } catch (e) {
      toast.error(`${id}: check failed. ${(e as Error).message}`, { duration: Infinity });
    }
  }, [simulated, qc]);

  const items = teams.data?.items ?? [];
  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Jump to a team or page, or run a health check.">
        <Command>
        <CommandInput placeholder="Type a team, page or action" />
        <CommandList>
          <CommandEmpty>{teams.isLoading ? 'Loading teams…' : 'Nothing matches.'}</CommandEmpty>
          {recent.length > 0 && (
            <CommandGroup heading="Recent teams">
              {recent.map(t => (
                <CommandItem key={`r-${t.id}`} value={`recent ${t.id} ${t.name}`} onSelect={() => go(`/teams/${t.id}`)}>
                  <History aria-hidden="true" /><span className="font-mono text-xs">{t.id}</span> {t.name}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandGroup heading="Go to">
            <CommandItem value="page overview" onSelect={() => go('/overview')}><LayoutDashboard aria-hidden="true" />Overview</CommandItem>
            <CommandItem value="page incidents failing teams" onSelect={() => go('/overview?view=incidents')}><Siren aria-hidden="true" />Incidents</CommandItem>
            <CommandItem value="page teams" onSelect={() => go('/teams')}><Users aria-hidden="true" />Teams</CommandItem>
            <CommandItem value="page audit log" onSelect={() => go('/audit')}><ClipboardList aria-hidden="true" />Audit log</CommandItem>
            {role === 'organizer_admin' && <CommandItem value="page settings freeze accounts" onSelect={() => go('/settings')}><Settings aria-hidden="true" />Settings</CommandItem>}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Teams">
            {items.map(t => (
              <CommandItem key={t.id} value={`team ${t.id} ${t.name}`} onSelect={() => go(`/teams/${t.id}`)}>
                <Users aria-hidden="true" /><span className="font-mono text-xs">{t.id}</span> {t.name}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Run check now">
            {items.filter(t => t.lifecycleState === 'running').map(t => (
              <CommandItem key={`c-${t.id}`} value={`check run ${t.id} ${t.name}`} onSelect={() => void runCheck(t.id)}>
                <Activity aria-hidden="true" />Run check: <span className="font-mono text-xs">{t.id}</span> {t.name}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
        </Command>
      </CommandDialog>

      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Everything in the console can be reached with the keyboard.</DialogDescription>
          </DialogHeader>
          <dl className="grid gap-2 text-sm">
            {SHORTCUTS.map(s => (
              <div key={s.keys} className="grid grid-cols-[150px_1fr] gap-3">
                <dt><kbd className="rounded border border-[var(--border-strong)] bg-[var(--surface-inset)] px-1.5 py-0.5 font-mono text-xs">{s.keys}</kbd></dt>
                <dd className="text-[var(--muted)]">{s.what}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
