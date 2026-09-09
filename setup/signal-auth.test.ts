import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawnSync: vi.fn(),
}));
vi.mock('./status.js', () => ({ emitStatus: vi.fn() }));

import { emitStatus } from './status.js';
import { run } from './signal-auth.js';

const spawnResult = (stdout = '') => ({
  pid: 1,
  output: [null, stdout, ''],
  stdout,
  stderr: '',
  status: 0,
  signal: null,
});

describe('signal-auth CLI discovery', () => {
  let home: string;
  let originalHome: string | undefined;
  let originalOverride: string | undefined;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-signal-auth-'));
    fs.mkdirSync(path.join(home, '.local/bin'), { recursive: true });
    fs.writeFileSync(path.join(home, '.local/bin/signal-cli'), 'fixture');
    originalHome = process.env.HOME;
    originalOverride = process.env.SIGNAL_CLI_PATH;
    process.env.HOME = home;
    delete process.env.SIGNAL_CLI_PATH;
    vi.mocked(spawnSync)
      .mockReset()
      .mockReturnValueOnce(spawnResult())
      .mockReturnValueOnce(spawnResult('[{"number":"+15551234567","registered":true}]'));
    vi.mocked(emitStatus).mockClear();
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalOverride === undefined) delete process.env.SIGNAL_CLI_PATH;
    else process.env.SIGNAL_CLI_PATH = originalOverride;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('uses the installer path when a non-login shell cannot resolve signal-cli', async () => {
    await run([]);

    const installedCli = path.join(home, '.local/bin/signal-cli');
    expect(vi.mocked(spawnSync).mock.calls.map(([command]) => command)).toEqual([installedCli, installedCli]);
    expect(emitStatus).toHaveBeenCalledWith('SIGNAL_AUTH', {
      STATUS: 'skipped',
      ACCOUNT: '+15551234567',
      REASON: 'already-authenticated',
    });
  });
});
