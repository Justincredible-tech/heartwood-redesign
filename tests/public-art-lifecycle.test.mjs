import test from 'node:test';

import assert from 'node:assert/strict';

import { mkdir, writeFile, readFile, lstat, readdir } from 'node:fs/promises';

import { join } from 'node:path';

import { createToolRuntime, inspectProcess, signalOwnedProcess, ownedProcesses } from '../tools/mobile-art/lifecycle/tool-runtime.mjs';

const worker = join(import.meta.dirname, 'fixtures/art-transaction-worker.mjs');

import { nativeArtTestState } from './fixtures/native-art-test-support.mjs';

const nativeState = nativeArtTestState();

const rt = nativeState.enabled ? createToolRuntime({
  name: 'focused public art lifecycle regression',
  runTimeoutMs: 6e4,
  shutdownMs: 8e3
}) : null;

if (rt) await rt.ready;

const exists = async p => {
  try {
    await lstat(p);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
};

async function fixture(mode, {signal: signal, launcherDeath: launcherDeath = false} = {}) {
  const root = await rt.tempDir('public-art-fixture-'), parent = join(root, 'source/mobile');
  await mkdir(join(parent, 'art/author empty folder'), {
    recursive: true
  });
  await writeFile(join(parent, 'art/art.txt'), 'OLD');
  await writeFile(join(parent, 'art/empty note é.txt'), '');
  const child = await rt.spawn(process.execPath, [ launcherDeath ? join(import.meta.dirname, 'fixtures/art-transaction-launcher.mjs') : worker, root, mode ], {
    stdio: [ 'ignore', 'pipe', 'pipe' ],
    label: 'owned public art ' + mode
  });
  let stdout = '', stderr = '', readyResolve;
  const ready = new Promise(res => {
    readyResolve = res;
  });
  child.stdout.on('data', b => {
    stdout += b;
    for (const line of stdout.split('\n').slice(0, -1)) if (line.startsWith('@@artFixture ')) {
      const row = JSON.parse(line.slice(13));
      if (row.runDir) readyResolve(row);
    }
  });
  child.stderr.on('data', b => {
    stderr += b;
  });
  let owned;
  if (signal || launcherDeath) {
    owned = await rt.deadline('specific rename-gap ownership receipt', () => ready, {
      timeoutMs: 1e4
    });
    const target = launcherDeath ? rt.ownerRecord.helper : owned.helper;
    if (launcherDeath) {
      const launcher = inspectProcess(target.binary, child.pid);
      assert.equal(signalOwnedProcess(target.binary, {
        ...launcher,
        token: rt.runId,
        role: 'caller-owned'
      }, rt.runId, 'SIGKILL'), true);
    } else assert.equal(signalOwnedProcess(target.binary, {
      ...owned.worker,
      token: owned.token,
      role: 'worker'
    }, owned.token, signal), true);
  }
  const closed = await rt.deadline('owned public art worker exits', () => child.toolClosed, {
    timeoutMs: 12e3
  });
  if (!owned) {
    const row = stdout.split('\n').find(line => line.startsWith('@@artFixture ') && JSON.parse(line.slice(13)).runDir);
    if (row) owned = JSON.parse(row.slice(13));
  }
  if (owned) await rt.deadline('exact public art scope cleanup proof', async () => {
    for (;;) {
      const live = ownedProcesses(owned.helper.binary, owned.token), registry = await exists(owned.runDir), scratch = await exists(owned.scratch);
      if (!live.length && !registry && !scratch) return;
      await new Promise(r => setTimeout(r, 25));
    }
  }, {
    timeoutMs: 1e4
  });
  const source = join(parent, 'art');
  return {
    root: root,
    parent: parent,
    source: source,
    stdout: stdout,
    stderr: stderr,
    closed: closed,
    owned: owned
  };
}

test('public library returns to its caller and removes only its handlers/env', {
  skip: nativeState.enabled ? false : nativeState.reason
}, async () => {
  const run = await fixture('sequential');
  assert.equal(run.closed.code, 0, run.stderr);
  const row = JSON.parse(run.stdout.split('\n').find(l => l.startsWith('@@artFixture ')).slice(13));
  assert.deepEqual(row.after, row.before);
  assert.equal(row.envRestored, true);
  assert.equal(row.callerSurvived, true);
  assert.equal(await readFile(join(run.source, 'art.txt'), 'utf8'), 'OLD');
  assert.deepEqual((await readdir(run.parent)).sort(), [ 'art' ]);
});

test('normal committed promotion is complete with no marker/backup', {
  skip: nativeState.enabled ? false : nativeState.reason
}, async () => {
  const run = await fixture('commit');
  assert.equal(run.closed.code, 0, run.stderr);
  assert.equal(await readFile(join(run.source, 'art.txt'), 'utf8'), 'NEW');
  assert.deepEqual((await readdir(run.parent)).sort(), [ 'art' ]);
  assert.equal(await exists(join(run.source, '.hw-tool-owner')), false);
  assert.equal((await lstat(join(run.source, 'empty note é.txt'))).size, 0);
  assert((await lstat(join(run.source, 'author empty folder'))).isDirectory());
});

test('typed art move cannot replace a concurrent foreign backup', {
  skip: nativeState.enabled ? false : nativeState.reason
}, async () => {
  const run = await fixture('foreign-backup');
  assert.notEqual(run.closed.code, 0);
  assert.equal(await readFile(join(run.source, 'art.txt'), 'utf8'), 'OLD');
  const backup = (await readdir(run.parent)).find(n => n.startsWith('.art-backup-'));
  assert(backup);
  assert.equal(await readFile(join(run.parent, backup, 'foreign.txt'), 'utf8'), 'KEEP');
  assert.match(run.stderr, /File exists/);
});

test('ordinary thrown error restores old inode after unjournaled first rename', {
  skip: nativeState.enabled ? false : nativeState.reason
}, async () => {
  const run = await fixture('error');
  assert.equal(run.closed.code, 1, run.stderr);
  assert.match(run.stderr, /exact deliberate transaction error/);
  assert.equal(await readFile(join(run.source, 'art.txt'), 'utf8'), 'OLD');
  assert.deepEqual((await readdir(run.parent)).sort(), [ 'art' ]);
});

test('native stop and death recover both exact rename windows', {
  skip: nativeState.enabled ? false : nativeState.reason
}, async () => {
  for (const [mode, signal, expected] of [ [ 'old-gap', 'SIGTERM', 143 ], [ 'old-gap', 'SIGKILL', null ], [ 'new-gap', 'SIGKILL', null ] ]) {
    const run = await fixture(mode, {
      signal: signal
    });
    if (expected) assert.equal(run.closed.code, expected, run.stderr); else assert.equal(run.closed.signal, 'SIGKILL');
    assert.equal(await readFile(join(run.source, 'art.txt'), 'utf8'), mode === 'new-gap' ? 'NEW' : 'OLD');
    assert.deepEqual((await readdir(run.parent)).sort(), [ 'art' ]);
    assert.equal(await exists(join(run.source, '.hw-tool-owner')), false);
  }
});

test('external deadline survives synchronous worker block and restores original', {
  skip: nativeState.enabled ? false : nativeState.reason
}, async () => {
  const run = await fixture('timeout');
  assert.notEqual(run.closed.code, 0, 'A timed out worker cannot pass');
  assert.match(run.stderr, /whole-run timeout/);
  assert.equal(await readFile(join(run.source, 'art.txt'), 'utf8'), 'OLD');
  assert.deepEqual((await readdir(run.parent)).sort(), [ 'art' ]);
});

test('launcher death retires the worker before recovering the old rename gap', {
  skip: nativeState.enabled ? false : nativeState.reason
}, async () => {
  const run = await fixture('old-gap', {
    launcherDeath: true
  });
  assert.equal(run.closed.signal, 'SIGKILL');
  assert.equal(await readFile(join(run.source, 'art.txt'), 'utf8'), 'OLD');
  assert.deepEqual((await readdir(run.parent)).sort(), [ 'art' ]);
  assert.match(run.stderr, /caller incarnation ended|worker incarnation ended/);
});

test('changed author backup is preserved and reported as a failure', {
  skip: nativeState.enabled ? false : nativeState.reason
}, async () => {
  const run = await fixture('backup-changed', {
    signal: 'SIGKILL'
  });
  assert.equal(run.closed.signal, 'SIGKILL');
  const names = await readdir(run.parent), backup = names.find(n => n.startsWith('.art-backup-'));
  assert(backup, 'Changed author backup must survive');
  assert.equal(await readFile(join(run.parent, backup, 'art.txt'), 'utf8'), 'AUTHOR EDIT');
  assert.equal(await readFile(join(run.source, 'art.txt'), 'utf8'), 'NEW');
  assert.equal(await exists(join(run.source, '.hw-tool-owner')), true);
  assert.match(run.stderr, /Author backup bytes changed/);
});

test('changed author empty directories are preserved even when every file hash matches', {
  skip: nativeState.enabled ? false : nativeState.reason
}, async () => {
  const run = await fixture('backup-directory-changed', {
    signal: 'SIGKILL'
  });
  assert.equal(run.closed.signal, 'SIGKILL');
  const backup = (await readdir(run.parent)).find(n => n.startsWith('.art-backup-'));
  assert(backup);
  assert((await lstat(join(run.parent, backup, 'additional author empty directory'))).isDirectory());
  assert.equal(await readFile(join(run.parent, backup, 'art.txt'), 'utf8'), 'OLD');
  assert.match(run.stderr, /Author backup bytes changed/);
});

test('owned output publication cleans itself and never replaces a foreign target', {
  skip: nativeState.enabled ? false : nativeState.reason
}, async () => {
  for (const mode of [ 'publication-normal', 'publication-death', 'foreign-output' ]) {
    const root = await rt.tempDir('art-output-fixture-');
    await mkdir(join(root, 'source/mobile/art'), {
      recursive: true
    });
    const child = await rt.spawn(process.execPath, [ join(import.meta.dirname, 'fixtures/art-output-worker.mjs'), root, mode ], {
      stdio: [ 'ignore', 'pipe', 'pipe' ],
      label: 'owned output ' + mode
    });
    let stdout = '', stderr = '', resolveReady;
    const ready = new Promise(res => {
      resolveReady = res;
    });
    child.stdout.on('data', b => {
      stdout += b;
      for (const line of stdout.split('\n').slice(0, -1)) if (line.startsWith('@@artOutput ')) resolveReady(JSON.parse(line.slice(12)));
    });
    child.stderr.on('data', b => {
      stderr += b;
    });
    const row = await rt.deadline('owned output publication receipt', () => ready, {
      timeoutMs: 1e4
    });
    if (mode === 'publication-death') assert.equal(signalOwnedProcess(row.helper.binary, {
      ...row.worker,
      token: row.token,
      role: 'worker'
    }, row.token, 'SIGKILL'), true);
    const closed = await rt.deadline('output allocation fixture exits', () => child.toolClosed, {
      timeoutMs: 1e4
    });
    if (mode === 'foreign-output') {
      assert.notEqual(closed.code, 0);
      assert.equal(await readFile(join(row.out, 'foreign.txt'), 'utf8'), 'KEEP');
      assert.equal(await exists(join(row.out, '.hw-tool-owner')), false);
    } else {
      if (mode === 'publication-normal') assert.equal(closed.code, 0, stderr); else assert.equal(closed.signal, 'SIGKILL');
      await rt.deadline('owned published output and scope cleaned', async () => {
        for (;;) {
          if (!await exists(row.out) && !await exists(row.runDir) && !await exists(row.scratch) && !ownedProcesses(row.helper.binary, row.token).length) return;
          await new Promise(r => setTimeout(r, 25));
        }
      }, {
        timeoutMs: 1e4
      });
    }
  }
});

test.after(async () => {
  if (!rt) return;
  const cleaned = await rt.shutdown('focused public art checks finished');
  assert.deepEqual(cleaned.errors, []);
});
