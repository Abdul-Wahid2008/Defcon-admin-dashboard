import { afterEach, describe, it, expect, vi } from 'vitest';
import { can, User, Resource, Permission } from '../src/lib/server/permissions';

describe('Permissions System', () => {
  const adminUser: User = { id: 'u-admin', role: 'organizer_admin' };
  const operatorUser: User = { id: 'u-op', role: 'organizer_operator' };
  const teamUser: User = { id: 'u-team', role: 'team', teamId: 'team-01' };

  const teamA: Resource = { teamId: 'team-01' };
  const teamB: Resource = { teamId: 'team-02' };

  const ALL_PERMISSIONS: Permission[] = [
    'team.read', 'team.create', 'team.update', 'team.delete',
    'env.start', 'env.stop', 'env.reset', 'credential.manage',
    'audit.read', 'settings.update', 'demo.use',
    'service.restart', 'service.reset', 'alert.ack', 'user.manage',
  ];

  describe('organizer_admin', () => {
    it('should have all permissions', () => {
      ALL_PERMISSIONS.forEach(p => {
        expect(can(adminUser, p)).toBe(true);
      });
    });
  });

  describe('organizer_operator', () => {
    const allowed: Permission[] = [
      'team.read', 'team.create', 'team.update',
      'env.start', 'env.stop', 'env.reset', 'credential.manage',
      'audit.read',
      'service.restart', 'service.reset', 'alert.ack',
    ];
    const forbidden: Permission[] = [
      'team.delete', 'settings.update', 'demo.use', 'user.manage',
    ];

    it('should have allowed permissions', () => {
      allowed.forEach(p => {
        expect(can(operatorUser, p)).toBe(true);
      });
    });

    it('should not have forbidden permissions', () => {
      forbidden.forEach(p => {
        expect(can(operatorUser, p)).toBe(false);
      });
    });
  });

  describe('team role', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('has only team.read by default; env.reset is denied unless TEAM_SELF_RESET=true', () => {
      expect(can(teamUser, 'team.read', teamA)).toBe(true);
      expect(can(teamUser, 'env.reset', teamA)).toBe(false);
      ALL_PERMISSIONS
        .filter(p => p !== 'team.read')
        .forEach(p => expect(can(teamUser, p, teamA)).toBe(false));
    });

    it('with TEAM_SELF_RESET=true the team gets env.reset on its own team only', () => {
      vi.stubEnv('TEAM_SELF_RESET', 'true');
      expect(can(teamUser, 'env.reset', teamA)).toBe(true);
      expect(can(teamUser, 'env.reset', teamB)).toBe(false);
      ALL_PERMISSIONS
        .filter(p => p !== 'team.read' && p !== 'env.reset')
        .forEach(p => expect(can(teamUser, p, teamA)).toBe(false));
    });

    it('should be denied access to other teams', () => {
      expect(can(teamUser, 'team.read', teamB)).toBe(false);
      expect(can(teamUser, 'env.reset', teamB)).toBe(false);
    });

    it('should be denied access if no resource is provided for team-scoped permissions', () => {
      expect(can(teamUser, 'team.read')).toBe(false);
      expect(can(teamUser, 'env.reset')).toBe(false);
    });

    it('should be denied if user has no teamId', () => {
      const brokenUser: User = { id: 'u-broken', role: 'team' };
      expect(can(brokenUser, 'team.read', teamA)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should return false for missing resource when required', () => {
      // organizer roles ignore teamId, so they should still pass
      expect(can(adminUser, 'team.read')).toBe(true);
      expect(can(operatorUser, 'team.read')).toBe(true);
    });

    it('should handle missing user roles gracefully', () => {
      const invalidUser = { id: 'u-inv', role: 'unknown' } as any;
      expect(can(invalidUser, 'team.read')).toBe(false);
    });
  });
});
