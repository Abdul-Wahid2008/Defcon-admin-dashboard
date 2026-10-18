'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { Activity, ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, Radar, ShieldCheck, Wifi } from 'lucide-react';
import { apiLogin } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  return <LoginForm />;
}

function LoginForm() {
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retryAfter, setRetryAfter] = useState(0);
  const nextRef = useRef('/overview');

  const usernameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const requestedPath = new URLSearchParams(window.location.search).get('next');
    if (requestedPath && /^\/(?![\/\\])/.test(requestedPath)) {
      const safePath = new URL(requestedPath, window.location.origin);
      if (safePath.origin === window.location.origin) {
        nextRef.current = `${safePath.pathname}${safePath.search}${safePath.hash}`;
      }
    }
    usernameRef.current?.focus();
  }, []);

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
      router.push(nextRef.current);
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
    <main className="login-shell">
      <div className="login-grid" aria-hidden="true" />
      <div className="login-orb login-orb-one" aria-hidden="true" />
      <div className="login-orb login-orb-two" aria-hidden="true" />
      <div className="login-layout">
        <motion.section
          className="login-brief"
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
        >
          <div className="eyebrow"><span className="eyebrow-dot" /> CONTROL PLANE / SECURE ACCESS</div>
          <div className="login-brand">
            <div className="brand-mark"><Radar size={27} strokeWidth={1.7} /></div>
            <div><p className="brand-kicker">DEFCON</p><p className="brand-name">CONTROL CENTER <span>2.0</span></p></div>
          </div>
          <h1>Operate with<br /><span>confidence.</span></h1>
          <p className="login-lede">A calm, auditable command surface for every team environment at Technozion.</p>
          <div className="login-signal-list">
            <div><ShieldCheck size={16} /><span>Permission-aware operations</span><b>READY</b></div>
            <div><Activity size={16} /><span>Live state reconciliation</span><b>ONLINE</b></div>
            <div><LockKeyhole size={16} /><span>Organizer network boundary</span><b>ENFORCED</b></div>
          </div>
        </motion.section>

        <motion.section
          className="login-card"
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, delay: 0.08, ease: 'easeOut' }}
        >
          <div className="login-card-top"><span>ORGANIZER AUTHENTICATION</span><Wifi size={16} /></div>
          <div className="login-card-heading">
            <h2>Welcome back</h2>
            <p>Sign in to access the operations console.</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form" noValidate>
          <div className="login-field">
            <Label htmlFor="username" className="login-label">
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
              className="login-input"
              placeholder="admin"
            />
          </div>

          <div className="login-field">
            <Label htmlFor="password" className="login-label">
              Password
            </Label>
            <div className="login-password-wrap">
              <Input
                id="password"
                type={showPw ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading || retryAfter > 0}
                required
                className="login-input login-password-input"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="login-password-toggle"
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {error && (
            <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} role="alert" aria-live="assertive" className="login-error">
              {retryAfter > 0 ? `Too many attempts. Retry in ${retryAfter}s.` : error}
            </motion.p>
          )}

          <Button
            type="submit"
            disabled={loading || retryAfter > 0 || !username || !password}
            className="login-submit"
            aria-busy={loading}
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin mr-2" aria-hidden="true" />
                Signing in…
              </>
            ) : (
              <>Enter control center <ArrowRight size={16} /></>
            )}
          </Button>
          </form>
          <div className="login-card-footer"><span>SIMULATED ENVIRONMENT</span><span className="footer-pulse" /> <span>LOCAL CONTROL PLANE</span></div>
        </motion.section>
      </div>
      <footer className="login-footer"><span>DEFCON 2.0 · TECHNOZION / NIT WARANGAL</span><span>SESSION ENCRYPTED · 8H TTL</span></footer>
    </main>
  );
}
