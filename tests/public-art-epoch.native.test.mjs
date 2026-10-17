// Optional recorded filesystem epochs; no product/browser/renderer mutations.
import test, { after } from 'node:test';

import assert from 'node:assert/strict';

import { writeFile, rename, mkdir, lstat } from 'node:fs/promises';

import { join } from 'node:path';

import { createHash } from 'node:crypto';

import { hashToolFile, verifyArtToolchainEpoch, recordArtDirectoryEpoch } from '../tools/mobile-art/lifecycle/art-toolchain.mjs';

import { createToolRuntime } from '../tools/mobile-art/lifecycle/tool-runtime.mjs';

import { nativeArtTestState } from './fixtures/native-art-test-support.mjs';

const state = nativeArtTestState();

const rt = state.enabled ? createToolRuntime({
  name: 'focused optional art disk epochs',
  runTimeoutMs: 2e4,
  shutdownMs: 8e3
}) : null;

const temps = [];

after(async () => {
  if (!rt) return;
  const result = await rt.shutdown('Art disk epoch cases complete');
  assert.deepEqual(result.errors, []);
  for (const path of temps) await assert.rejects(lstat(path), error => error.code === 'ENOENT');
});

test('matching file epochs succeed; restored same bytes at a new inode cannot pass', {
  skip: state.enabled ? false : state.reason
}, async () => {
  await rt.ready;
  const dir = await rt.tempDir('art-epoch-fixture-');
  temps.push(dir);
  const file = join(dir, 'tool.mjs');
  await writeFile(file, 'exact code');
  const observed = await hashToolFile(rt, file, {
    maxBytes: 1024
  });
  assert.equal(observed.sha256, createHash('sha256').update('exact code').digest('hex'));
  assert.equal((await verifyArtToolchainEpoch(rt)).files, 1);
  const replacement = join(dir, 'replacement');
  await writeFile(replacement, 'exact code');
  await rename(replacement, file);
  await assert.rejects(verifyArtToolchainEpoch(rt), /epoch changed/);
});

test('package census rejects a new member without changing existing bytes', {
  skip: state.enabled ? false : state.reason
}, async () => {
  await rt.ready;
  const dir = await rt.tempDir('art-census-fixture-');
  temps.push(dir);
  const pkg = join(dir, 'package');
  await mkdir(pkg);
  await writeFile(join(pkg, 'entry.js'), 'fixed');
  await hashToolFile(rt, join(pkg, 'entry.js'), {
    maxBytes: 1024
  });
  await recordArtDirectoryEpoch(rt, pkg, [ 'entry.js' ]);
  await writeFile(join(pkg, 'new-entry.js'), 'new');
  await assert.rejects(verifyArtToolchainEpoch(rt), /Toolchain directory (?:entry )?epoch changed/);
});
