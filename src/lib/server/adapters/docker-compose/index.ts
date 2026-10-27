import 'server-only';

import { execFile as nodeExecFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';

import { MockAdapter } from '../mock';
import type {
  AdapterCapabilities,
  ActionResponse,
  Alert,
  CompletedTransition,
  CreateTeamInput,
  EnvironmentAdapter,
  HealthSnapshot,
  IssuedCredential,
  LifecycleAction,
  OverviewData,
  Page,
  Participant,
  TeamDetail,
  TeamQuery,
  TeamSummary,
  UpdateTeamInput,
} from '../types';

const execFile = promisify(nodeExecFile);
const TEAM_ID_PATTERN = /^team-\d{2}$/;

export type ExecFile = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export interface DockerComposeAdapterOptions {
  exec?: ExecFile;
  templateDir?: string;
  teamsDir?: string;
}

export function isValidDockerTeamId(teamId: string): boolean {
  return TEAM_ID_PATTERN.test(teamId);
}

export function buildComposeArgs(teamId: string, composeFile: string, command: string[]): string[] {
  if (!isValidDockerTeamId(teamId)) throw new Error('INVALID_TEAM_ID');
  return ['compose', '-p', teamId, '-f', composeFile, ...command];
}

/**
 * @deprecated v1.2 (docs/12 D21): parses Cloudflare tunnel logs and expects a Docker socket on the web host. Kept only
 * so existing rehearsals keep working; do not extend. The supported real path is the allow-listed agent (ADAPTER=real).
 */
export class DockerComposeAdapter implements EnvironmentAdapter {
  readonly mode = 'docker-compose' as const;
  readonly capabilities: AdapterCapabilities = {
    resetKind: 'restart',
    serviceLevelReset: false,
    terminalMode: 'per_team',
    flagstores: 3,
  };
  readonly resetLabel = 'Restart (patch restore not available)';
  private readonly delegate: MockAdapter;
  private readonly execute: ExecFile;
  private readonly templateDir: string;
  private readonly teamsDir: string;

  constructor(options: DockerComposeAdapterOptions = {}) {
    this.delegate = new MockAdapter();
    this.execute =
      options.exec ??
      (async (file, args) => {
        const result = await execFile(file, args, { windowsHide: true });
        return { stdout: result.stdout, stderr: result.stderr };
      });
    this.templateDir = options.templateDir ?? path.resolve(process.cwd(), 'teams-template');
    this.teamsDir = options.teamsDir ?? path.resolve(process.cwd(), 'teams');
  }

  async listTeams(q: TeamQuery): Promise<Page<TeamSummary>> {
    return this.delegate.listTeams(q);
  }

  async getTeam(teamId: string): Promise<TeamDetail | null> {
    this.assertTeamId(teamId);
    const team = await this.delegate.getTeam(teamId);
    if (!team?.environment.terminal) return team;

    try {
      const logs = await this.executeCompose(teamId, ['logs', '--no-color', 'tunnel']);
      const url = logs.stdout.match(/https:\/\/[a-z0-9.-]+\.trycloudflare\.com(?:\/\S*)?/i)?.[0] ?? null;
      return {
        ...team,
        environment: {
          ...team.environment,
          terminal: { ...team.environment.terminal, url, isMock: false },
        },
      };
    } catch {
      return team;
    }
  }

  async createTeam(input: CreateTeamInput) {
    const result = await this.delegate.createTeam(input);
    this.assertTeamId(result.team.id);
    await this.renderComposeFile(result.team.id);
    await this.executeCompose(result.team.id, ['up', '-d', '--build']);
    return result;
  }

  async updateTeam(teamId: string, patch: UpdateTeamInput): Promise<TeamDetail> {
    this.assertTeamId(teamId);
    return this.delegate.updateTeam(teamId, patch);
  }

  async addParticipant(teamId: string, name: string): Promise<{ participant: Participant; credential: IssuedCredential }> {
    this.assertTeamId(teamId);
    return this.delegate.addParticipant(teamId, name);
  }

  async removeParticipant(teamId: string, participantId: string): Promise<void> {
    this.assertTeamId(teamId);
    return this.delegate.removeParticipant(teamId, participantId);
  }

  async rotateCredentials(teamId: string, participantId?: string): Promise<IssuedCredential[]> {
    this.assertTeamId(teamId);
    return this.delegate.rotateCredentials(teamId, participantId);
  }

  async requestAction(
    teamId: string,
    action: LifecycleAction,
    ctx: { correlationId: string },
  ): Promise<ActionResponse | { noop: true; reason: string }> {
    this.assertTeamId(teamId);
    const command =
      action === 'start'
        ? ['start']
        : action === 'stop'
          ? ['stop']
          : action === 'reset'
          ? ['down']
          : ['down', '-v'];

    const current = await this.delegate.getTeam(teamId);
    if (!current) {
      const error = new Error('NOT_FOUND');
      (error as Error & { code?: string }).code = 'NOT_FOUND';
      throw error;
    }
    const result = await this.delegate.requestAction(teamId, action, ctx);
    if ('noop' in result) return result;

    await this.executeCompose(teamId, command);
    if (action === 'reset') {
      await this.executeCompose(teamId, ['up', '-d']);
    }
    return result;
  }

  async runHealthChecks(teamId: string): Promise<HealthSnapshot> {
    this.assertTeamId(teamId);
    const snapshot = await this.delegate.runHealthChecks(teamId);
    const services = await Promise.all(
      snapshot.services.map(async (service) => {
        const reachable = await this.probePort(service.port);
        return {
          ...service,
          checks: service.checks.map((check) =>
            check.type === 'reachability'
              ? {
                  ...check,
                  status: reachable ? ('pass' as const) : ('fail' as const),
                  detail: reachable ? null : 'TCP connection failed',
                  lastCheckedAt: new Date().toISOString(),
                }
              : check,
          ),
        };
      }),
    );
    const health =
      services.some((service) => service.checks.some((check) => check.status === 'fail'))
        ? ('down' as const)
        : services.some((service) => service.checks.some((check) => check.status === 'unknown'))
        ? ('degraded' as const)
        : ('healthy' as const);
    return { ...snapshot, services, health };
  }

  async getOverviewData(): Promise<OverviewData> {
    const overview = await this.delegate.getOverviewData();
    return { ...overview, adapter: this.mode };
  }

  async listAlerts(q: { status?: 'open' | 'resolved'; limit?: number }): Promise<Alert[]> {
    return this.delegate.listAlerts(q);
  }

  async resolveDue(): Promise<CompletedTransition[]> {
    return this.delegate.resolveDue();
  }

  private assertTeamId(teamId: string): void {
    if (!isValidDockerTeamId(teamId)) {
      const error = new Error('INVALID_TEAM_ID');
      (error as Error & { code?: string }).code = 'INVALID_TEAM_ID';
      throw error;
    }
  }

  private composeFile(teamId: string): string {
    return path.join(this.teamsDir, teamId, 'docker-compose.yml');
  }

  private async renderComposeFile(teamId: string): Promise<void> {
    const template = await readFile(path.join(this.templateDir, 'docker-compose.yml'), 'utf8');
    const rendered = template.replaceAll('{{TEAM_ID}}', teamId).replaceAll('${TEAM_ID}', teamId);
    const file = this.composeFile(teamId);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, rendered, 'utf8');
  }

  async executeCompose(teamId: string, command: string[]): Promise<{ stdout: string; stderr: string }> {
    this.assertTeamId(teamId);
    return this.execute('docker', buildComposeArgs(teamId, this.composeFile(teamId), command));
  }

  private probePort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      const finish = (reachable: boolean) => {
        socket.destroy();
        resolve(reachable);
      };
      socket.setTimeout(2000, () => finish(false));
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
    });
  }
}
