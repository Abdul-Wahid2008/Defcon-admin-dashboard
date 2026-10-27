'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { ArrowRight, CheckCircle2, Eye, EyeOff, History, Loader2, Radar, ShieldCheck } from 'lucide-react';
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
      <div className="login-layout">
        <motion.section
          className="login-brief"
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
        >
          <div className="login-eyebrow">DEFCON 2.0 <span>/</span> ORGANIZER CONSOLE</div>
          <div className="login-brand">
            <div className="brand-mark"><Radar size={27} strokeWidth={1.7} /></div>
            <div><p className="brand-kicker">DEFCON 2.0</p><p className="brand-name">CONTROL CENTER</p></div>
          </div>
          <h1>DEFCON 2.0<br /><span>Control Center</span></h1>
          <p className="login-lede">Team environments, service health and the audit log for the event.</p>
          <div className="login-principles">
            <div className="login-principle">
              <span className="login-principle-icon"><CheckCircle2 size={17} /></span>
              <span><strong>Current state</strong><small>Which teams are running and which services are failing.</small></span>
            </div>
            <div className="login-principle">
              <span className="login-principle-icon"><ShieldCheck size={17} /></span>
              <span><strong>Roles and confirmations</strong><small>Destructive actions need the right role and a typed confirmation.</small></span>
            </div>
            <div className="login-principle">
              <span className="login-principle-icon"><History size={17} /></span>
              <span><strong>Audit log</strong><small>Every action is recorded and cannot be edited or deleted.</small></span>
            </div>
          </div>
          <div className="login-trust">
            <span className="login-trust-rule" />
            <span>Organizer accounts only</span>
          </div>
        </motion.section>

        <motion.section
          className="login-card"
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, delay: 0.08, ease: 'easeOut' }}
        >
          <div className="login-card-top"><span>Organizer sign in</span><span className="login-card-mode">Restricted</span></div>
          <div className="login-card-heading">
            <h2>Sign in</h2>
            <p>Use your organizer account.</p>
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
          <div className="login-card-footer"><span>ORGANIZER CONSOLE</span><span className="footer-pulse" /> <span>RESTRICTED ACCESS</span></div>
        </motion.section>
      </div>
      <footer className="login-footer"><span>DEFCON 2.0 · TECHNOZION / NIT WARANGAL</span><span>SESSION ENCRYPTED · 8H TTL</span></footer>
    </main>
  );
}
