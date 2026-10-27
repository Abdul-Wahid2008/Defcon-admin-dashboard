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
      <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
        <Sidebar role={user.role} />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <ConsoleClient user={user}>
            <FrozenBanner />
            <SimBanner />
            <main className="console-main flex-1 overflow-y-auto">
              <div className="console-content mx-auto w-full max-w-[1440px] px-6 py-6">
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
