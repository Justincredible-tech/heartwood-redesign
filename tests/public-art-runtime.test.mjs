import test from 'node:test';

import assert from 'node:assert/strict';

import { tmpdir } from 'node:os';

import { join, resolve } from 'node:path';

import { pathToFileURL } from 'node:url';

import { artJobOptions, artNetworkAllowed, runOwnedArtJob } from '../tools/mobile-art-runtime.mjs';

import { validateArtDescriptor, artDigest } from '../tools/mobile-art/lifecycle/art-transaction.mjs';

import { permissionDigest } from '../tools/mobile-art-integrity.mjs';

const options = {
  output: resolve(tmpdir(), 'explicit art bundle é'),
  browserExecutable: process.execPath
};

test('invalid options and unsupported ownership fail before resources', async () => {
  const env = {
    ...process.env
  };
  const listeners = process.listenerCount('SIGTERM');
  const invalid = [ {
    ...options,
    nope: true
  }, {
    ...options,
    timeoutMs: Infinity
  }, {
    ...options,
    shutdownMs: 9e3
  }, {
    ...options,
    output: ''
  } ];
  for (const opts of invalid) assert.throws(() => artJobOptions(opts, () => {}));
  assert.throws(() => artJobOptions(options, () => {}, {
    platform: 'win32'
  }), error => error.exitCode === 64 && error.code === 'HW_ART_PLATFORM_UNSUPPORTED');
  await assert.rejects(runOwnedArtJob({
    ...options,
    nope: true
  }, () => {}));
  assert.deepEqual(Object.keys(process.env).sort(), Object.keys(env).sort());
  for (const key of Object.keys(env)) assert.equal(process.env[key], env[key], 'Environment changed: ' + key);
  assert.equal(process.listenerCount('SIGTERM'), listeners);
});

test('renderer permits only in-memory URLs', () => {
  for (const url of [ 'data:image/svg+xml;base64,abc', 'about:blank', 'blob:internal' ]) {
    assert.equal(artNetworkAllowed(url), true);
  }
  const file = pathToFileURL(join(tmpdir(), 'art.svg')).href;
  for (const url of [ 'https://example.invalid', 'http://127.0.0.1', file, 'ftp://local' ]) {
    assert.equal(artNetworkAllowed(url), false);
  }
});

test('transaction descriptor allows unrelated empty Unicode files but no traversal', () => {
  const root = resolve(tmpdir(), 'exact art root é');
  const parent = join(root, 'source', 'mobile');
  const suffix = '01234567-0123-0123-0123-012345678901';
  const stage = join(parent, '.art-stage-' + suffix);
  const files = [ {
    path: 'empty note é.txt',
    bytes: 0,
    sha256: 'a'.repeat(64),
    mode: 292
  } ];
  const record = ino => ({
    dev: 1,
    ino: ino,
    files: files,
    directories: [],
    directoryModes: [],
    rootMode: 493,
    digest: artDigest(files),
    permissionDigest: permissionDigest({
      files: files,
      directories: [],
      directoryModes: [],
      rootMode: 493
    })
  });
  const ownership = {
    path: stage,
    dev: 1,
    ino: 3,
    token: 'local-token',
    resourceId: 'resource'
  };
  const descriptor = {
    schema: 1,
    type: 'mobile-art-directory',
    parent: {
      path: parent,
      dev: 1,
      ino: 1
    },
    sourcePath: join(parent, 'art'),
    stagePath: stage,
    backupPath: join(parent, '.art-backup-' + suffix),
    old: record(2),
    new: record(3),
    sourceInputRows: [ {
      origin: 'project',
      path: 'source/mobile/app.js',
      bytes: 1,
      sha256: 'b'.repeat(64)
    } ]
  };
  assert.equal(validateArtDescriptor(descriptor, {
    projectRoot: root,
    ownership: ownership
  }), descriptor);
  for (const path of [ '../art.txt', 'a//b', 'a\\b', 'a\nb' ]) {
    const bad = structuredClone(descriptor);
    bad.new.files[0].path = path;
    bad.new.digest = artDigest(bad.new.files);
    assert.throws(() => validateArtDescriptor(bad, {
      projectRoot: root,
      ownership: ownership
    }));
  }
});
