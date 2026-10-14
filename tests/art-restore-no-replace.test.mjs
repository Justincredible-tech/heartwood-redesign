// Existing authenticated native no-replace primitive, exercised for recovery paths only.
import test, { after } from 'node:test';

import assert from 'node:assert/strict';

import { mkdir, writeFile, readFile, lstat } from 'node:fs/promises';

import { join } from 'node:path';

import { createToolRuntime } from '../tools/mobile-art/lifecycle/tool-runtime.mjs';

import * as transaction from '../tools/mobile-art/lifecycle/art-transaction.mjs';

import { nativeArtTestState } from './fixtures/native-art-test-support.mjs';

const nativeState = nativeArtTestState();

const rt = nativeState.enabled ? createToolRuntime({
  name: 'typed no-replace art restore',
  runTimeoutMs: 15e3
}) : null;

const temps = [];

after(async () => {
  if (!rt) return;
  const cleanup = await rt.shutdown('typed no-replace restore complete');
  assert.deepEqual(cleanup.errors, []);
  for (const path of temps) await assert.rejects(lstat(path), e => e.code === 'ENOENT');
});

test('rollback restores the exact old directory through authenticated native no-replace', {
  skip: nativeState.enabled ? false : nativeState.reason
}, async () => {
  assert.equal(typeof transaction.restoreArtDirectory, 'function', 'route rollback through native exclusive move');
  await rt.ready;
  const parent = await rt.tempDir('art-restore-fixture-');
  temps.push(parent);
  const backup = join(parent, 'backup'), source = join(parent, 'art');
  await mkdir(backup);
  await writeFile(join(backup, 'author.txt'), 'original');
  const old = await lstat(backup), p = await lstat(parent);
  await transaction.restoreArtDirectory({
    backupPath: backup,
    sourcePath: source,
    old: {
      dev: old.dev,
      ino: old.ino
    },
    parent: {
      path: parent,
      dev: p.dev,
      ino: p.ino
    }
  }, {
    run: rt.ownerRecord,
    deadlineAt: Date.now() + 3e3
  });
  assert.equal((await lstat(source)).ino, old.ino);
  assert.equal(await readFile(join(source, 'author.txt'), 'utf8'), 'original');
  await assert.rejects(lstat(backup), e => e.code === 'ENOENT');
});

test('a foreign empty target cannot be replaced by rollback; backup and target both survive', {
  skip: nativeState.enabled ? false : nativeState.reason
}, async () => {
  assert.equal(typeof transaction.restoreArtDirectory, 'function');
  await rt.ready;
  const parent = await rt.tempDir('art-restore-foreign-');
  temps.push(parent);
  const backup = join(parent, 'backup'), source = join(parent, 'art');
  await mkdir(backup);
  await writeFile(join(backup, 'author.txt'), 'KEEP');
  await mkdir(source);
  const old = await lstat(backup), foreign = await lstat(source), p = await lstat(parent);
  await assert.rejects(transaction.restoreArtDirectory({
    backupPath: backup,
    sourcePath: source,
    old: {
      dev: old.dev,
      ino: old.ino
    },
    parent: {
      path: parent,
      dev: p.dev,
      ino: p.ino
    }
  }, {
    run: rt.ownerRecord,
    deadlineAt: Date.now() + 3e3
  }), /no-replace publication failed/);
  assert.equal((await lstat(source)).ino, foreign.ino);
  assert.equal((await lstat(backup)).ino, old.ino);
  assert.equal(await readFile(join(backup, 'author.txt'), 'utf8'), 'KEEP');
});
