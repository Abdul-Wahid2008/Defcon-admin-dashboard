'use client';

import { useState } from 'react';
import { Download, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import type { IssuedCredential } from '@/lib/schemas';
import { Button } from '@/components/ui/button';
import { csvRow } from '@/lib/csv';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { useRef, useEffect, type ReactNode } from 'react';

function Overlay({
  children,
  labelledBy,
  describedBy,
}: {
  children: ReactNode;
  labelledBy: string;
  describedBy?: string;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overlay = overlayRef.current;
    if (!overlay) return undefined;
    const focusableSelector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    const focusFirst = () => {
      const first = overlay.querySelector<HTMLElement>(focusableSelector);
      first?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // Intentionally DO NOT close on Escape: require explicit acknowledgment
      if (event.key === 'Escape') {
        event.preventDefault();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(overlay.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    overlay.addEventListener('keydown', onKeyDown);
    window.requestAnimationFrame(focusFirst);
    return () => {
      document.body.style.overflow = previousOverflow;
      overlay.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    >
      <Card className="max-h-[90vh] w-full max-w-3xl overflow-auto border-[var(--border-strong)] bg-[var(--panel)] shadow-2xl">
        <CardContent className="p-6">{children}</CardContent>
      </Card>
    </div>
  );
}

export function CredentialsReveal({
  credentials,
  onClose,
}: {
  credentials: IssuedCredential[];
  onClose: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [visible, setVisible] = useState<string[]>([]);
  const allVisible = visible.length === credentials.length;

  const toggleVisible = (participantId: string) =>
    setVisible((current) =>
      current.includes(participantId)
        ? current.filter((id) => id !== participantId)
        : [...current, participantId],
    );

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value);
    toast.success('Copied to clipboard');
  };

  const copyAll = () => copy(credentials.map((item) => `${item.username}\t${item.password}`).join('\n'));

  const download = () => {
    const csv = [
      'participant_id,username,password',
      ...credentials.map((item) => csvRow([item.participantId, item.username, item.password])),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'defcon-credentials.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Overlay labelledBy="credentials-dialog-title" describedBy="credentials-dialog-description">
      <h2 id="credentials-dialog-title" className="mb-2 text-lg font-semibold text-[var(--text)]">
        Credentials — save these now
      </h2>
      <p id="credentials-dialog-description" className="mb-4 text-sm text-[var(--bad)] font-medium">
        Passwords are shown only once and cannot be retrieved later.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setVisible(allVisible ? [] : credentials.map((item) => item.participantId))}
        >
          {allVisible ? <EyeOff size={14} /> : <Eye size={14} />}
          {allVisible ? 'Hide all' : 'Reveal all'}
        </Button>
        <Button size="sm" variant="outline" onClick={copyAll}>
          Copy all
        </Button>
        <Button size="sm" variant="outline" onClick={() => window.print()}>
          Print
        </Button>
      </div>
      <div className="overflow-x-auto rounded border border-[var(--border)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Participant</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Password</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {credentials.map((credential) => (
              <TableRow key={credential.participantId}>
                <TableCell className="font-medium">{credential.participantId}</TableCell>
                <TableCell className="font-mono text-xs">{credential.username}</TableCell>
                <TableCell>
                  <span className="font-mono text-xs">
                    {visible.includes(credential.participantId) ? credential.password : '••••••••••••'}
                  </span>
                  <button
                    type="button"
                    className="ml-2 rounded p-1 text-[var(--muted)] hover:text-[var(--accent)]"
                    onClick={() => toggleVisible(credential.participantId)}
                    aria-label={`${visible.includes(credential.participantId) ? 'Hide' : 'Reveal'} password for ${credential.username}`}
                  >
                    {visible.includes(credential.participantId) ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => copy(`${credential.username}\t${credential.password}`)}
                  >
                    Copy
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm text-[var(--text)] cursor-pointer">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          className="rounded border-[var(--border-strong)] accent-[var(--accent)]"
        />{' '}
        I have saved these credentials
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={download}>
          <Download size={15} />Download CSV
        </Button>
        <Button disabled={!saved} onClick={onClose}>
          Close
        </Button>
      </div>
    </Overlay>
  );
}
