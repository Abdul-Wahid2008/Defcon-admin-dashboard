'use client';

import { useState } from 'react';
import { KeyRound, LogOut, Plus, UserX } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  apiCreateUser, apiDisableUser, apiListUsers, apiResetUserPassword, apiRevokeUserSessions,
  type OrganizerUser,
} from '@/lib/api-admin';
import type { IssuedCredential } from '@/lib/schemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CredentialsReveal } from '@/components/teams/CredentialsReveal';
import { RelativeTime } from '@/components/ui/relative-time';

const EMPTY_FORM = { username: '', displayName: '', role: 'organizer_operator' as OrganizerUser['role'] };

export function OrganizerAccounts({ currentUserId }: { currentUserId: string | undefined }) {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: apiListUsers });
  const [reveal, setReveal] = useState<IssuedCredential[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [pendingDisable, setPendingDisable] = useState<OrganizerUser | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const showPassword = (r: { user: OrganizerUser; password: string }) =>
    setReveal([{ participantId: r.user.id, username: r.user.username, password: r.password }]);

  const create = useMutation({
    mutationFn: () => apiCreateUser(form),
    onSuccess: (r) => { setCreateOpen(false); setForm(EMPTY_FORM); showPassword(r); void refresh(); },
  });
  const reset = useMutation({
    mutationFn: (id: string) => apiResetUserPassword(id),
    onSuccess: (r) => { showPassword(r); void refresh(); },
    onError: (e) => toast.error(e.message),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiRevokeUserSessions(id),
    onSuccess: (r) => { toast.success(`Sessions revoked for ${r.user.username}`); void refresh(); },
    onError: (e) => toast.error(e.message),
  });
  const disable = useMutation({
    mutationFn: (id: string) => apiDisableUser(id),
    onSuccess: (r) => { setPendingDisable(null); toast.success(`${r.user.username} disabled`); void refresh(); },
  });

  return (
    <Card className="console-surface lg:col-span-2">
      <CardHeader className="flex-row items-center justify-between border-b border-[var(--border)]">
        <CardTitle>Organizer accounts</CardTitle>
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus size={16} />Add organizer</Button>
      </CardHeader>
      <CardContent className="overflow-x-auto pt-4">
        {users.error ? <p role="alert" className="text-sm text-[var(--bad)]">{users.error.message}</p> : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead><TableHead>Name</TableHead><TableHead>Role</TableHead>
              <TableHead>Status</TableHead><TableHead>Last login</TableHead><TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(users.data?.items ?? []).map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-mono text-xs">{u.username}{u.id === currentUserId ? ' (you)' : ''}</TableCell>
                <TableCell>{u.displayName}</TableCell>
                <TableCell>{u.role === 'organizer_admin' ? 'Admin' : 'Operator'}</TableCell>
                <TableCell>{u.active ? (u.mustChangePassword ? 'Active, must change password' : 'Active') : 'Disabled'}</TableCell>
                <TableCell><RelativeTime ts={u.lastLoginAt} /></TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" disabled={!u.active || reset.isPending} onClick={() => reset.mutate(u.id)}><KeyRound size={16} />Reset password</Button>
                    <Button size="sm" variant="ghost" disabled={!u.active || revoke.isPending} onClick={() => revoke.mutate(u.id)}><LogOut size={16} />Revoke sessions</Button>
                    <Button size="sm" variant="ghost" disabled={!u.active || u.id === currentUserId} title={u.id === currentUserId ? 'You cannot disable your own account' : undefined} onClick={() => setPendingDisable(u)}><UserX size={16} />Disable</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {users.data && users.data.items.length === 0 && <p className="py-6 text-center text-sm text-[var(--muted)]">No organizer accounts.</p>}
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add organizer</DialogTitle>
            <DialogDescription>A one-time password is shown after creation. The organizer must change it at first login.</DialogDescription>
          </DialogHeader>
          <label className="grid gap-1 text-sm font-medium" htmlFor="new-username">Username<Input id="new-username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoFocus /></label>
          <label className="grid gap-1 text-sm font-medium" htmlFor="new-display">Display name<Input id="new-display" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label>
          <label className="grid gap-1 text-sm font-medium" htmlFor="new-role">Role
            <select id="new-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as OrganizerUser['role'] })} className="h-9 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-inset)] px-2 text-sm">
              <option value="organizer_operator">Operator</option>
              <option value="organizer_admin">Admin</option>
            </select>
          </label>
          {create.error && <p role="alert" className="text-sm text-[var(--bad)]">{create.error.message}</p>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={() => create.mutate()} disabled={create.isPending || !form.username.trim() || !form.displayName.trim()}>{create.isPending ? 'Creating…' : 'Create organizer'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingDisable} onOpenChange={(open) => !open && setPendingDisable(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable {pendingDisable?.username}?</DialogTitle>
            <DialogDescription>The account can no longer sign in and its sessions end immediately. Audit history is kept.</DialogDescription>
          </DialogHeader>
          {disable.error && <p role="alert" className="text-sm text-[var(--bad)]">{disable.error.message}</p>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" onClick={() => pendingDisable && disable.mutate(pendingDisable.id)} disabled={disable.isPending}>{disable.isPending ? 'Disabling…' : 'Disable account'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {reveal && <CredentialsReveal credentials={reveal} onClose={() => setReveal(null)} />}
    </Card>
  );
}
