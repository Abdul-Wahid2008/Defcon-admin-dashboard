'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Users, ScrollText, Settings, Shield, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMeta } from '@/lib/queries';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/overview', label: 'Overview', icon: LayoutDashboard },
  { href: '/teams', label: 'Teams', icon: Users },
  { href: '/audit', label: 'Audit Log', icon: ScrollText },
  { href: '/settings', label: 'Settings', icon: Settings, adminOnly: true },
];

interface SidebarProps {
  role: string;
}

export function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname();
  const { data: meta } = useMeta();

  const visibleItems = NAV_ITEMS.filter(
    item => !item.adminOnly || role === 'organizer_admin',
  );

  return (
    <aside
      className="hidden md:flex flex-col w-[240px] shrink-0 border-r bg-[var(--panel)]"
      style={{ borderColor: 'var(--border)' }}
    >
      {/* Logo */}
      <div className="px-4 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <Shield size={18} className="text-[var(--accent)]" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-[var(--text)] leading-tight">
              DEFCON Control Center
            </p>
            <p className="font-mono text-[10px] text-[var(--muted)] mt-0.5">v{meta?.version ?? '1.1.0'}</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5" aria-label="Main navigation">
        {visibleItems.map(item => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                active
                  ? 'bg-[var(--accent)]/10 text-[var(--accent)] font-medium'
                  : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-2)]',
              )}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={16} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Adapter info */}
      <div className="px-4 py-3 border-t text-[10px] text-[var(--muted)] font-mono" style={{ borderColor: 'var(--border)' }}>
        <span className="uppercase tracking-wide">
          {meta?.adapter === 'mock' ? 'SIMULATED' : meta?.adapter === 'real' ? 'LIVE' : 'PARTIAL'}
        </span>
        {' · '}
        <span className="capitalize">{role.replace('organizer_', '')}</span>
      </div>
    </aside>
  );
}
