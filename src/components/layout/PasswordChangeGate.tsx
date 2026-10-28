'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiChangePassword } from '@/lib/api-admin';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Blocks the console until a must-change-password account sets a new password (docs/12 D20). */
export function PasswordChangeGate() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const change = useMutation({
    mutationFn: () => apiChangePassword(current, next),
    onSuccess: () => window.location.reload(),
  });
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="pw-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <form
        className="grid w-full max-w-md gap-3 rounded-xl border border-[var(--border-strong)] bg-[var(--panel)] p-6"
        onSubmit={(e) => { e.preventDefault(); change.mutate(); }}
      >
        <h2 id="pw-title" className="text-base font-semibold">Change your password</h2>
        <p className="text-sm text-[var(--muted)]">An administrator issued this password. Choose a new one (at least 12 characters) to continue.</p>
        <label className="grid gap-1 text-sm font-medium" htmlFor="pw-current">Current password<Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus /></label>
        <label className="grid gap-1 text-sm font-medium" htmlFor="pw-new">New password<Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
        {change.error && <p role="alert" className="text-sm text-[var(--bad)]">{change.error.message}</p>}
        <Button type="submit" disabled={change.isPending || !current || next.length < 12}>{change.isPending ? 'Saving…' : 'Change password'}</Button>
      </form>
    </div>
  );
}
