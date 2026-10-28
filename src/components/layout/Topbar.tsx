'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { LogOut, ChevronDown, User, Menu, LayoutDashboard, Users, ScrollText, Settings, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { AdapterBadge } from './AdapterBadge';
import { useMeta } from '@/lib/queries';
import { apiLogout } from '@/lib/api-client';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface TopbarProps {
  title: string;
  user: { username: string; displayName: string; role: string };
}

function ServerClock() {
  const { data } = useMeta();
  const [display, setDisplay] = useState('');

  useEffect(() => {
    const update = () => {
      if (!data?.serverTime) return;
      const offset = Date.now() - new Date(data.serverTime).getTime();
      const serverNow = new Date(Date.now() - offset);
      setDisplay(
        serverNow.toLocaleTimeString('en-GB', { hour12: false }) + ' UTC',
      );
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [data?.serverTime]);

  if (!display) return null;
  return (
    <span className="font-mono text-xs text-[var(--muted)] hidden sm:block" aria-live="off">
      {display}
    </span>
  );
}

export function Topbar({ title, user }: TopbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        event.preventDefault();
        document.getElementById('global-team-search')?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = search.trim();
    if (value) router.push(`/teams?q=${encodeURIComponent(value)}`);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await apiLogout();
    } catch { /* ignore */ }
    router.push('/login');
  };

  const roleLabel = user.role
    .replace('organizer_', '')
    .replace('_', ' ');
  const mobileNav = [
    { href: '/overview', label: 'Overview', Icon: LayoutDashboard },
    { href: '/teams', label: 'Teams', Icon: Users },
    { href: '/audit', label: 'Audit log', Icon: ScrollText },
    ...(user.role === 'organizer_admin' ? [{ href: '/settings', label: 'Settings', Icon: Settings }] : []),
  ];

  return (
    <header className="h-14 border-b" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
      <div className="page-container flex h-full items-center gap-4" data-qa="topbar-inner">
      <Sheet>
        <SheetTrigger render={<button className="grid size-8 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--text)] md:hidden" aria-label="Open navigation" />}>
          <Menu size={18} aria-hidden="true" />
        </SheetTrigger>
        <SheetContent side="left" className="w-[min(82vw,300px)] border-r border-[var(--border)] bg-[var(--panel)] p-0">
          <SheetHeader className="border-b border-[var(--border)]">
            <SheetTitle className="text-left text-[var(--text)]">DEFCON Control Center</SheetTitle>
          </SheetHeader>
          <nav className="grid gap-1 p-3" aria-label="Mobile navigation">
            {mobileNav.map(({ href, label, Icon }) => (
              <Link key={href} href={href} className={`flex items-center gap-3 rounded-md px-3 py-3 text-sm ${pathname.startsWith(href) ? 'bg-cyan-300/10 text-[var(--accent)]' : 'text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]'}`}>
                <Icon size={16} aria-hidden="true" />{label}
              </Link>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text)]">
        {title}
      </h1>

      <div className="flex items-center gap-3">
        <form onSubmit={submitSearch} className="relative hidden w-48 lg:block" role="search">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-2 text-[var(--muted)]" aria-hidden="true" />
          <Input id="global-team-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a team  /" aria-label="Find a team" className="h-8 pl-8 pr-8 text-xs" />
          <kbd className="pointer-events-none absolute right-2 top-1.5 rounded border border-[var(--border)] px-1 text-[10px] text-[var(--muted)]">/</kbd>
        </form>
        <ServerClock />
        <AdapterBadge />

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex h-8 items-center gap-2 rounded px-2 text-xs text-[var(--muted)] hover:text-[var(--text)]"
            aria-label="User menu"
          >
            <User size={14} aria-hidden="true" />
            <span className="hidden sm:block">{user.displayName}</span>
            <span className="text-[10px] text-[var(--muted)] hidden sm:block capitalize">
              ({roleLabel})
            </span>
            <ChevronDown size={12} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-3 py-2">
              <p className="text-xs font-medium text-[var(--text)]">{user.displayName}</p>
              <p className="text-[10px] text-[var(--muted)] font-mono capitalize">{roleLabel}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              disabled={loggingOut}
              className="text-[var(--bad)] focus:text-[var(--bad)] cursor-pointer"
            >
              <LogOut size={14} className="mr-2" aria-hidden="true" />
              {loggingOut ? 'Logging out…' : 'Log out'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      </div>
    </header>
  );
}
