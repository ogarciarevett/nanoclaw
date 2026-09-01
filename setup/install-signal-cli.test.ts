import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';

const originalTmpDirs: string[] = [];

afterEach(() => {
  for (const dir of originalTmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function executable(file: string, contents: string): void {
  writeFileSync(file, contents);
  chmodSync(file, 0o755);
}

describe('install-signal-cli', () => {
  it('downloads the sanctioned signal-cli version', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nanoclaw-signal-cli-'));
    originalTmpDirs.push(root);
    const bin = path.join(root, 'bin');
    const capture = path.join(root, 'url');
    mkdirSync(bin);

    executable(path.join(bin, 'uname'), '#!/bin/sh\necho Linux\n');
    executable(
      path.join(bin, 'curl'),
      `#!/bin/sh
out=
last=
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then out=$2; shift 2; continue; fi
  last=$1
  shift
done
printf '%s\n' "$last" > "$CAPTURE_URL"
: > "$out"
`,
    );
    executable(
      path.join(bin, 'tar'),
      `#!/bin/sh
dir=
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-C" ]; then dir=$2; shift 2; continue; fi
  shift
done
printf '#!/bin/sh\n' > "$dir/signal-cli"
`,
    );

    const result = spawnSync('bash', ['setup/install-signal-cli.sh'], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: {
        ...process.env,
        CAPTURE_URL: capture,
        HOME: root,
        PATH: `${bin}:${process.env.PATH}`,
      },
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(capture, 'utf8')).toContain('/v0.14.7/signal-cli-0.14.7-Linux-native.tar.gz');
    expect(JSON.parse(readFileSync('versions.json', 'utf8'))['signal-cli']).toBe('0.14.7');
  });
});
