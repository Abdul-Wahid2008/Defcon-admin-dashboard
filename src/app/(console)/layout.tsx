import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { jwtVerify } from 'jose';
import { QueryProvider } from '@/providers/query-provider';
import { Sidebar } from '@/components/layout/Sidebar';
import { SimBanner } from '@/components/layout/SimBanner';
import { Toaster } from '@/components/ui/sonner';
import { getSessionSecret } from '@/lib/session-secret';
import ConsoleClient from './ConsoleClient';

const SESSION_COOKIE = 'dc_session';

async function getUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    return {
      id: payload.sub as string,
      username: payload['username'] as string,
      displayName: payload['displayName'] as string,
      role: payload['role'] as string,
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
