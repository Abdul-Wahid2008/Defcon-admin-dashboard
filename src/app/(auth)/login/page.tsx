'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Eye, EyeOff, Shield, Loader2 } from 'lucide-react';
import { apiLogin } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ background: 'var(--bg)' }} />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/overview';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retryAfter, setRetryAfter] = useState(0);

  const usernameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { usernameRef.current?.focus(); }, []);

  // Countdown for rate limit
  useEffect(() => {
    if (retryAfter <= 0) return;
    const id = setInterval(() => {
      setRetryAfter(r => {
        if (r <= 1) { clearInterval(id); return 0; }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [retryAfter]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || retryAfter > 0) return;
    setError('');
    setLoading(true);
    try {
      await apiLogin(username, password);
      router.push(next);
    } catch (err: unknown) {
      const apiError = err as { code?: string; details?: { retryAfter?: number } };
      if (apiError.code === 'RATE_LIMITED') {
        const retrySeconds = apiError.details?.retryAfter ?? 60;
        setRetryAfter(retrySeconds);
        setError(`Too many attempts. Try again in ${retrySeconds}s.`);
      } else {
        setError('Invalid username or password.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'var(--bg)' }}
    >
      <div
        className="w-full max-w-sm rounded-lg border p-8 shadow-xl"
        style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full mb-4"
            style={{ background: 'var(--accent)20' }}>
            <Shield size={24} className="text-[var(--accent)]" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-[var(--text)]">DEFCON Control Center</h1>
          <p className="text-xs text-[var(--muted)] mt-1">Organizer access only</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="username" className="text-xs text-[var(--muted)]">
              Username
            </Label>
            <Input
              id="username"
              ref={usernameRef}
              type="text"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              disabled={loading || retryAfter > 0}
              required
              className="bg-[var(--panel-2)] border-[var(--border)] text-[var(--text)] placeholder:text-[var(--muted)]"
              placeholder="admin"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs text-[var(--muted)]">
              Password
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPw ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading || retryAfter > 0}
                required
                className="bg-[var(--panel-2)] border-[var(--border)] text-[var(--text)] pr-10"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] transition-colors"
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="text-xs text-[var(--bad)] bg-[var(--bad)]/10 border border-[var(--bad)]/20 rounded px-3 py-2"
            >
              {retryAfter > 0 ? `Too many attempts. Retry in ${retryAfter}s.` : error}
            </p>
          )}

          <Button
            type="submit"
            disabled={loading || retryAfter > 0 || !username || !password}
            className="w-full bg-[var(--accent)] text-[var(--bg)] hover:bg-[var(--accent)]/90 font-semibold"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin mr-2" aria-hidden="true" />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </Button>
        </form>

        {/* Adapter badge at footer */}
        <p className="text-center text-[10px] text-[var(--muted)] mt-6 font-mono">
          DEFCON 2.0 · Technozion · NIT Warangal
        </p>
      </div>
    </div>
  );
}
