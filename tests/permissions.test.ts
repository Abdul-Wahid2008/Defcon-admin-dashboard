import { describe, it, expect } from 'vitest';
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
    ];
    const forbidden: Permission[] = [
      'team.delete', 'settings.update', 'demo.use',
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
    it('should only have team.read and env.reset', () => {
      expect(can(teamUser, 'team.read', teamA)).toBe(true);
      expect(can(teamUser, 'env.reset', teamA)).toBe(true);

      // Every other permission should be denied
      ALL_PERMISSIONS
        .filter(p => p !== 'team.read' && p !== 'env.reset')
        .forEach(p => {
          expect(can(teamUser, p, teamA)).toBe(false);
        });
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
