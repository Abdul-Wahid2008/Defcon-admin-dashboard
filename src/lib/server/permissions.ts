import 'server-only';
import { loadConfig } from '../config';

export type Role = 'organizer_admin' | 'organizer_operator' | 'team';

export type Permission =
  | 'team.read'
  | 'team.create'
  | 'team.update'
  | 'team.delete'
  | 'env.start'
  | 'env.stop'
  | 'env.reset'
  | 'credential.manage'
  | 'audit.read'
  | 'settings.update'
  | 'demo.use'
  | 'service.restart'
  | 'service.reset'
  | 'alert.ack'
  | 'user.manage';

export interface User {
  id: string;
  role: Role;
  teamId?: string;
}

export interface Resource {
  teamId?: string;
}

const ROLE_PERMISSIONS: Record<Role, Set<Permission>> = {
  organizer_admin: new Set([
    'team.read', 'team.create', 'team.update', 'team.delete',
    'env.start', 'env.stop', 'env.reset', 'credential.manage',
    'audit.read', 'settings.update', 'demo.use',
    'service.restart', 'service.reset', 'alert.ack', 'user.manage',
  ]),
  organizer_operator: new Set([
    'team.read', 'team.create', 'team.update',
    'env.start', 'env.stop', 'env.reset', 'credential.manage',
    'audit.read',
    'service.restart', 'service.reset', 'alert.ack',
  ]),
  team: new Set([
    'team.read',
    'env.reset', // only effective when TEAM_SELF_RESET=true, see can()
  ]),
};

/**
 * Checks if a user has permission to perform an action on a resource.
 * Follows rules in docs/04 §3.
 */
export function can(user: User, permission: Permission, resource?: Resource): boolean {
  const permissions = ROLE_PERMISSIONS[user.role];
  if (!permissions || !permissions.has(permission)) {
    return false;
  }

  // Role 'team' is restricted to their own team only
  if (user.role === 'team') {
    if (permission === 'env.reset' && !loadConfig().teamSelfReset) return false;
    if (!user.teamId || !resource?.teamId || user.teamId !== resource.teamId) {
      return false;
    }
  }

  return true;
}

/** Machine principals are not roles: they authenticate with a bearer token and hold exactly one capability. */
export type MachinePrincipal = 'ingest';
export type MachinePermission = 'ingest.write';

const MACHINE_PERMISSIONS: Record<MachinePrincipal, ReadonlySet<MachinePermission>> = {
  ingest: new Set<MachinePermission>(['ingest.write']),
};

export function machineCan(principal: MachinePrincipal, permission: MachinePermission): boolean {
  return MACHINE_PERMISSIONS[principal].has(permission);
}
