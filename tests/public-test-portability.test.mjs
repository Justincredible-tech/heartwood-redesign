import test from 'node:test';

import assert from 'node:assert/strict';

import { nativeArtTestState, nativeToolchainTestState } from './fixtures/native-art-test-support.mjs';

import { publicTestOptions } from '../tools/test-public.mjs';

import { summarizePublicTests, validatePublicTestResult } from '../tools/public-test-results.mjs';

test('default public tests need no native platform, compiler or encoder modules', () => {
  assert.equal(nativeArtTestState({
    requested: false,
    platform: 'win32',
    compilerExists: false
  }).enabled, false);
  assert.equal(nativeToolchainTestState({
    requested: false,
    platform: 'win32',
    compilerExists: false
  }).enabled, false);
  assert.deepEqual(publicTestOptions([]), {
    nativeArt: false,
    nativeToolchain: false
  });
  assert.equal(publicTestOptions([ '--help' ]).help, true);
  for (const args of [ [ '--wat' ], [ '--native-art', 'extra' ], [ '--native-art', '--native-art-toolchain' ] ]) {
    assert.throws(() => publicTestOptions(args), error => error.exitCode === 64);
  }
});

test('explicit native requests fail clearly on unsupported hosts and missing prerequisites', () => {
  for (const platform of [ 'win32', 'linux' ]) {
    assert.throws(() => nativeArtTestState({
      requested: true,
      platform: platform,
      compilerExists: true
    }), /UNSUPPORTED/);
  }
  assert.throws(() => nativeArtTestState({
    requested: true,
    platform: 'darwin',
    compilerExists: false
  }), /compiler/);
  assert.throws(() => nativeToolchainTestState({
    requested: true,
    platform: 'darwin',
    compilerExists: true,
    sharpModule: '',
    playwrightModule: ''
  }), /explicit installed/);
});

test('enabled native test options actually execute and report an ordinary passing subtest', async t => {
  const state = nativeArtTestState({requested: true, platform: 'darwin', compilerExists: true});
  let executed = false;
  await t.test('enabled option executes', {skip: state.enabled ? false : state.reason}, () => {
    executed = true;
    assert.equal(state.enabled, true);
  });
  assert.equal(executed, true);
});

test('public completion requires a real passing executed case in every required file', () => {
  const files = [ 'tests/first.test.mjs', 'tests/second.test.mjs' ];
  const optional = {
    art: 'NOT_RUN',
    encoder: 'NOT_RUN'
  };
  const positive = files.map(file => ({
    file: file,
    type: 'pass'
  }));
  const result = summarizePublicTests(files, positive, optional);
  assert.equal(validatePublicTestResult(result, files), result);
  const badRuns = [ [], positive.slice(1), [ ...positive, {
    file: files[0],
    type: 'fail'
  } ], positive.map(event => ({
    ...event,
    skip: true
  })), positive.map(event => ({
    ...event,
    todo: true
  })), [ ...positive, {
    type: 'fail',
    file: null
  } ], [ ...positive, {
    type: 'pass',
    file: 'unrequested.test.mjs'
  } ] ];
  for (const events of badRuns) {
    const bad = summarizePublicTests(files, events, optional);
    assert.equal(bad.status, 'FAIL');
    assert.throws(() => validatePublicTestResult(bad, files));
  }
  assert.throws(() => summarizePublicTests([], [], optional), /nonempty/);
  assert.throws(() => summarizePublicTests([ files[0], files[0] ], positive, optional), /Duplicate/);
  assert.throws(() => validatePublicTestResult({
    ...result,
    tests: result.tests + 1
  }, files));
});
