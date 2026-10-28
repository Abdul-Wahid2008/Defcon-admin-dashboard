import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { QueryProvider } from '@/providers/query-provider';
import { Sidebar } from '@/components/layout/Sidebar';
import { SimBanner } from '@/components/layout/SimBanner';
import { Toaster } from '@/components/ui/sonner';
import { resolveSession } from '@/lib/server/auth';
import { FrozenBanner } from '@/components/layout/FrozenBanner';
import ConsoleClient from './ConsoleClient';

const SESSION_COOKIE = 'dc_session';

async function getUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    // Same check as the API: a revoked or disabled account must not keep seeing the console.
    const user = await resolveSession(token);
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role as string,
      mustChangePassword: user.mustChangePassword === true,
    };
  } catch {
    return null;
  }
}

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  return (
    <QueryProvider>
      <div className="flex h-dvh overflow-hidden" style={{ background: 'var(--bg)' }}>
        <Sidebar role={user.role} />
        {/* One scroll region for topbar, banners and page, so they all share the same width (and scrollbar gutter). */}
        <div className="console-scroll min-w-0 flex-1 overflow-y-auto">
          <ConsoleClient user={user} banners={<><FrozenBanner /><SimBanner /></>}>
            <main className="console-main">
              <div className="console-content page-container py-6" data-qa="page-content">
                {children}
              </div>
            </main>
          </ConsoleClient>
        </div>
      </div>
      <Toaster position="bottom-right" richColors closeButton />
    </QueryProvider>
  );
}
