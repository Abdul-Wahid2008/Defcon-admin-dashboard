import { describe, expect, it, vi } from 'vitest';
import {
  buildComposeArgs,
  DockerComposeAdapter,
  isValidDockerTeamId,
} from '../src/lib/server/adapters/docker-compose';

describe('DockerComposeAdapter', () => {
  it('validates the compose project team id strictly', () => {
    expect(isValidDockerTeamId('team-01')).toBe(true);
    expect(isValidDockerTeamId('team-1')).toBe(false);
    expect(isValidDockerTeamId('team-01; rm -rf /')).toBe(false);
    expect(() => buildComposeArgs('team-1', 'teams/team-1/docker-compose.yml', ['start'])).toThrow(
      'INVALID_TEAM_ID',
    );
  });

  it('uses an injected executor and argument arrays without a shell', async () => {
    const execute = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const adapter = new DockerComposeAdapter({ exec: execute });

    await adapter.executeCompose('team-07', ['up', '-d', '--build']);

    expect(execute).toHaveBeenCalledWith(
      'docker',
      ['compose', '-p', 'team-07', '-f', expect.stringContaining('teams'), 'up', '-d', '--build'],
    );
  });

  it('keeps volumes for reset but removes them for delete', () => {
    expect(buildComposeArgs('team-02', 'teams/team-02/docker-compose.yml', ['down'])).not.toContain('-v');
    expect(buildComposeArgs('team-02', 'teams/team-02/docker-compose.yml', ['down', '-v'])).toContain('-v');
  });
});
