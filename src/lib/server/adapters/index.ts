import 'server-only';
import { DockerComposeAdapter } from './docker-compose';
import { MockAdapter } from './mock';
import { EnvironmentAdapter } from './types';

let _adapter: EnvironmentAdapter | null = null;

export function getAdapter(): EnvironmentAdapter {
  if (!_adapter) {
    const adapterType = process.env.ADAPTER || 'mock';
    if (adapterType === 'mock') {
      _adapter = new MockAdapter();
    } else if (adapterType === 'docker-compose') {
      _adapter = new DockerComposeAdapter();
    } else {
      _adapter = new MockAdapter();
    }
  }
  return _adapter;
}
