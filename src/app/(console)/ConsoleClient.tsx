'use client';

import { Topbar } from '@/components/layout/Topbar';
import { usePathname } from 'next/navigation';
import { PasswordChangeGate } from '@/components/layout/PasswordChangeGate';
import { CommandPalette } from '@/components/layout/CommandPalette';

const TITLE_MAP: Record<string, string> = {
  '/overview': 'Overview',
  '/teams': 'Teams',
  '/audit': 'Audit Log',
  '/settings': 'Settings',
};

function getTitle(pathname: string): string {
  if (pathname.startsWith('/teams/')) return 'Team Detail';
  return TITLE_MAP[pathname] || 'DEFCON Control Center';
}

interface ConsoleClientProps {
  user: { id: string; username: string; displayName: string; role: string; mustChangePassword?: boolean };
  banners?: React.ReactNode;
  children: React.ReactNode;
}

export default function ConsoleClient({ user, banners, children }: ConsoleClientProps) {
  const pathname = usePathname();
  return (
    <>
      {user.mustChangePassword && <PasswordChangeGate />}
      <CommandPalette role={user.role} />
      <div className="sticky top-0 z-30">
        <Topbar title={getTitle(pathname)} user={user} />
        {banners}
      </div>
      {children}
    </>
  );
}
