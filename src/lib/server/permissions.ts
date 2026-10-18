import 'server-only';

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
  | 'demo.use';

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
  ]),
  organizer_operator: new Set([
    'team.read', 'team.create', 'team.update',
    'env.start', 'env.stop', 'env.reset', 'credential.manage',
    'audit.read',
  ]),
  team: new Set([
    'team.read',
    'env.reset',
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
    if (!user.teamId || !resource?.teamId || user.teamId !== resource.teamId) {
      return false;
    }
  }

  return true;
}
