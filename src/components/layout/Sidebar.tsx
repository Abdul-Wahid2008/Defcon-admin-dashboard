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
      className="hidden w-[240px] shrink-0 flex-col border-r bg-[var(--panel)] md:flex"
      style={{ borderColor: 'var(--border)' }}
    >
      {/* Logo */}
      <div className="border-b px-4 py-5" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-cyan-300/30 bg-cyan-300/10">
            <Shield size={17} className="text-[var(--accent)]" aria-hidden="true" />
          </div>
          <div>
          <p className="text-sm font-semibold leading-tight text-[var(--text)]">
            DEFCON Control Center
          </p>
          <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">control plane · v{meta?.version ?? '…'}</p>
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
                'flex items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-sm transition-colors',
                active
                  ? 'border-cyan-300/20 bg-cyan-300/10 font-medium text-[var(--accent)]'
                  : 'text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]',
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
      <div className="border-t px-4 py-3 text-[10px] font-mono text-[var(--muted)]" style={{ borderColor: 'var(--border)' }}>
        <span className="uppercase tracking-wide">
          {meta?.adapter === 'mock' ? 'SIMULATED' : meta?.adapter === 'real' ? 'LIVE' : 'PARTIAL'}
        </span>
        {' · '}
        <span className="capitalize">{role.replace('organizer_', '')}</span>
      </div>
    </aside>
  );
}
