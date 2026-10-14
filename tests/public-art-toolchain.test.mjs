// Optional local dependency proof, never part of the ordinary Node-only roster.
import test from 'node:test';

import assert from 'node:assert/strict';

import { join } from 'node:path';

import { lstat } from 'node:fs/promises';

import { createToolRuntime, signalOwnedProcess, ownedProcesses } from '../tools/mobile-art/lifecycle/tool-runtime.mjs';

import { nativeToolchainTestState } from './fixtures/native-art-test-support.mjs';

const nativeState = nativeToolchainTestState();

const rt = nativeState.enabled ? createToolRuntime({
  name: 'focused public art toolchain proof',
  runTimeoutMs: 4e4,
  shutdownMs: 8e3
}) : null;

if (rt) await rt.ready;

test('exact installed dependency/native closure and same-marker output retention', {
  skip: nativeState.enabled ? false : nativeState.reason
}, async () => {
  const root = await rt.tempDir('art-toolchain-fixture-'), output = join(root, 'bundle'), child = await rt.spawn(process.execPath, [ join(import.meta.dirname, 'fixtures/art-toolchain-worker.mjs'), output ], {
    stdio: [ 'ignore', 'pipe', 'pipe' ],
    label: 'owned pinned local encoder worker'
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => {
    stdout += b;
  });
  child.stderr.on('data', b => {
    stderr += b;
  });
  const closed = await rt.deadline('pinned encoder/toolchain proof exits', () => child.toolClosed, {
    timeoutMs: 3e4
  });
  assert.equal(closed.code, 0, stderr);
  const line = stdout.split('\n').find(l => l.startsWith('@@artToolchain '));
  assert(line, 'Empty proof output cannot pass');
  const row = JSON.parse(line.slice(15));
  assert.equal(row.markerResourcePreserved, true);
  assert.equal(row.browser, 'NOT_LOADED');
  assert(row.encodedBytes > 0);
  console.log('Local installed overrides exercised; cold optional installation and Chromium rendering remain NOT_RUN');
});

test('failed or dead jobs cannot retain provisional completed bundles', {
  skip: nativeState.enabled ? false : nativeState.reason
}, async () => {
  for (const mode of [ 'fail-after-retain', 'death-after-retain', 'guard-fail-after-retain' ]) {
    const root = await rt.tempDir('art-retention-fixture-'), output = join(root, 'bundle'), child = await rt.spawn(process.execPath, [ join(import.meta.dirname, 'fixtures/art-toolchain-worker.mjs'), output, mode ], {
      stdio: [ 'ignore', 'pipe', 'pipe' ],
      label: 'owned provisional retention ' + mode
    });
    let stdout = '', stderr = '', resolveReady;
    const ready = new Promise(res => {
      resolveReady = res;
    });
    child.stdout.on('data', b => {
      stdout += b;
      for (const line of stdout.split('\n').slice(0, -1)) if (line.startsWith('@@artRetention ')) resolveReady(JSON.parse(line.slice(15)));
    });
    child.stderr.on('data', b => {
      stderr += b;
    });
    let owner;
    if (mode === 'death-after-retain') {
      owner = await rt.deadline('owned provisional bundle death boundary', () => ready, {
        timeoutMs: 1e4
      });
      assert.equal(signalOwnedProcess(owner.helper.binary, {
        ...owner.worker,
        token: owner.token,
        role: 'worker'
      }, owner.token, 'SIGKILL'), true);
    }
    const closed = await rt.deadline('provisional retention worker ends', () => child.toolClosed, {
      timeoutMs: 15e3
    });
    assert.notEqual(closed.code, 0, 'failed/dead retention cannot pass');
    if (owner) await rt.deadline('exact provisional scope gone', async () => {
      while (ownedProcesses(owner.helper.binary, owner.token).length) await new Promise(r => setTimeout(r, 25));
    }, {
      timeoutMs: 1e4
    });
    await assert.rejects(lstat(output), e => e.code === 'ENOENT');
    if (mode === 'fail-after-retain') assert.match(stderr, /exact deliberate failure after retention/);
    if (mode === 'guard-fail-after-retain') assert.match(stderr, /unsupported-art-proof/);
  }
});

test.after(async () => {
  if (!rt) return;
  const cleanup = await rt.shutdown('local toolchain proof finished');
  assert.deepEqual(cleanup.errors, []);
});
