import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { DockerComposeAdapter } from './docker-compose';
import { MockAdapter } from './mock';
import { AgentAdapter } from './agent';
import { EnvironmentAdapter } from './types';
import { loadConfig, type AppConfig } from '../../config';

let _adapter: EnvironmentAdapter | null = null;

export function getAdapter(): EnvironmentAdapter {
  if (!_adapter) {
    _adapter = createAdapter(loadConfig());
  }
  return _adapter;
}

export function createAdapter(config: AppConfig): EnvironmentAdapter {
  if (config.adapter === 'mock') {
    return new MockAdapter();
  }
  if (config.adapter === 'docker-compose') {
    const templatePath = path.resolve(process.cwd(), 'teams-template', 'docker-compose.yml');
    if (!fs.existsSync(templatePath)) {
      throw new Error('ADAPTER=docker-compose requires teams-template/docker-compose.yml.');
    }
    return new DockerComposeAdapter();
  }
  if (!config.orchestratorBaseUrl || !config.orchestratorToken || !config.orchestratorTimeoutMs) {
    throw new Error('ADAPTER=real requires ORCHESTRATOR_BASE_URL, ORCHESTRATOR_TOKEN, and ORCHESTRATOR_TIMEOUT_MS.');
  }
  // PARTIAL until the one-team evidence gate (W8): the agent contract in docs/15 §3 is a proposal, not a club fact.
  return new AgentAdapter({
    baseUrl: config.orchestratorBaseUrl,
    token: config.orchestratorToken,
    timeoutMs: config.orchestratorTimeoutMs,
  });
}
