import fs from 'fs';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ root: '', prepare: vi.fn() }));
vi.mock('./config.js', async (importOriginal) => {
  const config = await importOriginal<typeof import('./config.js')>();
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-spawn-'));
  return { ...config, DATA_DIR: path.join(fixture.root, 'data'), GROUPS_DIR: path.join(fixture.root, 'groups') };
});
vi.mock('./drivers/index.js', () => ({
  getSessionDriver: () => ({ kind: 'fixture', capabilities: () => ({}), prepare: fixture.prepare }),
  isSessionEventsDriver: () => false,
}));

import { isContainerRunning, killContainer, wakeContainer } from './container-runner.js';
import { ensureContainerConfig } from './db/container-configs.js';
import { getSessionClaim } from './db/coordination.js';
import {
  closeDb,
  createAgentGroup,
  createSession,
  deleteAgentGroup,
  deleteSession,
  getSession,
  initTestDb,
  runMigrations,
} from './db/index.js';
import type { SupervisedHandle } from './drivers/session-events.js';
import type { SessionSpec } from './drivers/types.js';
import { resetGatewayProvider } from './gateway-providers/index.js';

const release = vi.fn(async () => {});
const start = vi.fn(async () => {});
const stop = vi.fn(async () => {});
let duringEnsure: () => Promise<void>;

beforeEach(async () => {
  release.mockClear();
  start.mockClear();
  stop.mockClear();
  duringEnsure = async () => {};
  fixture.prepare.mockReset().mockImplementation(
    async (spec: SessionSpec): Promise<SupervisedHandle> => ({
      key: spec.key,
      name: 'fixture',
      start,
      stop,
      status: async () => ({ phase: 'stopped' }),
      execSpec: () => {
        throw new Error('unused');
      },
      onTerminal: () => {},
    }),
  );
  resetGatewayProvider({
    kind: 'fixture',
    agentSkills: [],
    sessions: {
      ensure: async () => {
        await duringEnsure();
        return { contribution: { networkAccess: { endpoint: 'localhost', target: { kind: 'host' } } }, release };
      },
    },
    approvals: { subscribe: async () => {} },
  });
  await runMigrations(await initTestDb());
  const now = new Date().toISOString();
  await createAgentGroup({
    id: 'spawn-group',
    name: 'Spawn',
    folder: 'spawn-group',
    agent_provider: null,
    created_at: now,
  });
  await ensureContainerConfig('spawn-group');
  await createSession({
    id: 'spawn-session',
    agent_group_id: 'spawn-group',
    messaging_group_id: null,
    thread_id: null,
    agent_provider: null,
    status: 'active',
    container_status: 'stopped',
    last_active: now,
    created_at: now,
  });
});
afterEach(async () => {
  if (isContainerRunning('spawn-session')) {
    killContainer('spawn-session', 'test-teardown');
    await vi.waitFor(() => expect(isContainerRunning('spawn-session')).toBe(false));
  }
  resetGatewayProvider();
  await closeDb();
});
afterAll(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

it.each(['group', 'session'])(
  'does not prepare a container when its %s disappears during gateway setup',
  async (deleted) => {
    const session = await getSession('spawn-session');
    expect(session).toBeDefined();
    if (!session) throw new Error('missing fixture');
    duringEnsure = async () => {
      await deleteSession('spawn-session');
      if (deleted === 'group') {
        await deleteAgentGroup('spawn-group');
        fs.rmSync(`${fixture.root}/groups/spawn-group`, { recursive: true, force: true });
      }
    };
    expect(await wakeContainer(session)).toBe(false);
    expect(fixture.prepare).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect((await getSessionClaim(session.id))?.claimed_by).toBeNull();
    expect(release).toHaveBeenCalledOnce();
    if (deleted === 'group') expect(fs.existsSync(`${fixture.root}/groups/spawn-group`)).toBe(false);
  },
);

it('still starts a session that survives gateway setup', async () => {
  const session = await getSession('spawn-session');
  if (!session) throw new Error('missing fixture');
  expect(await wakeContainer(session)).toBe(true);
  expect(fixture.prepare).toHaveBeenCalledOnce();
  expect(start).toHaveBeenCalledOnce();
  expect(release).not.toHaveBeenCalled();
});

it('does not start a session deleted while the driver prepares it', async () => {
  const session = await getSession('spawn-session');
  if (!session) throw new Error('missing fixture');
  const prepare = fixture.prepare.getMockImplementation();
  if (!prepare) throw new Error('missing driver fixture');
  fixture.prepare.mockImplementationOnce(async (spec: SessionSpec) => {
    const handle = await prepare(spec);
    await deleteSession('spawn-session');
    return handle;
  });
  expect(await wakeContainer(session)).toBe(false);
  expect(fixture.prepare).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledWith('start-failed');
  expect(start).not.toHaveBeenCalled();
  expect((await getSessionClaim(session.id))?.claimed_by).toBeNull();
  expect(release).toHaveBeenCalledOnce();
});
