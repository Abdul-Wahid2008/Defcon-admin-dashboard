'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { LogOut, ChevronDown, User } from 'lucide-react';
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
  const [loggingOut, setLoggingOut] = useState(false);

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

  return (
    <header
      className="h-14 flex items-center gap-4 px-4 border-b shrink-0"
      style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
    >
      {/* Page title */}
      <h1 className="text-sm font-semibold text-[var(--text)] flex-1 truncate">
        {title}
      </h1>

      <div className="flex items-center gap-3">
        <ServerClock />
        <AdapterBadge />

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex items-center gap-2 text-[var(--muted)] hover:text-[var(--text)] h-8 px-2 rounded text-xs"
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
    </header>
  );
}
