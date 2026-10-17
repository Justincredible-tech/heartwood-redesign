import assert from 'node:assert/strict';

import { spawn } from 'node:child_process';

import { readdir, realpath } from 'node:fs/promises';

import { join } from 'node:path';

import { fileURLToPath } from 'node:url';

import {
  NATIVE_ART_TEST_FILES, NATIVE_TOOLCHAIN_TEST_FILES, nativeArtTestState, nativeToolchainTestState
} from '../tests/fixtures/native-art-test-support.mjs';

import { validatePublicTestResult } from './public-test-results.mjs';
import { executePublicPythonTests } from './public-python-tests.mjs';

const HELP = 'Usage: node tools/test-public.mjs [--native-art | --native-art-toolchain]\n' +
  'Default: every portable Node/Python public test. Native art/encoder proofs are explicit optional checks.\n' +
  'Python: HW_PUBLIC_TEST_PYTHON executable and HW_PUBLIC_TEST_PYTHON_ARGS JSON argv array; default python.\n';

export function publicTestOptions(args) {
  if (args.length === 1 && [ '--help', '-h' ].includes(args[0])) return {
    help: true
  };
  if (!args.length) return {
    nativeArt: false,
    nativeToolchain: false
  };
  if (args.length === 1 && args[0] === '--native-art') return {
    nativeArt: true,
    nativeToolchain: false
  };
  if (args.length === 1 && args[0] === '--native-art-toolchain') return {
    nativeArt: true,
    nativeToolchain: true
  };
  throw Object.assign(Error(HELP.trim()), {
    exitCode: 64
  });
}

export async function publicTestPlan(root, options) {
  const entries = await readdir(join(root, 'tests'), {
    withFileTypes: true
  });
  const all = entries.filter(entry => entry.isFile() && entry.name.endsWith('.test.mjs')).map(entry => entry.name);
  const pythonFiles = entries.filter(entry => entry.isFile() && entry.name.endsWith('.test.py'))
    .map(entry => 'tests/' + entry.name).sort();
  for (const entry of entries) {
    if (/\.test\.(?:mjs|py)$/.test(entry.name)) assert(entry.isFile(), 'Test files must be regular: ' + entry.name);
  }
  assert(all.length > 0, 'No public test files found');
  for (const name of [ ...NATIVE_ART_TEST_FILES, ...NATIVE_TOOLCHAIN_TEST_FILES ]) {
    assert(all.includes(name), 'Public optional test missing: ' + name);
  }
  nativeArtTestState({
    requested: options.nativeArt
  });
  nativeToolchainTestState({
    requested: options.nativeToolchain
  });
  const files = all.filter(name => (
    (!NATIVE_ART_TEST_FILES.includes(name) || options.nativeArt) &&
    (!NATIVE_TOOLCHAIN_TEST_FILES.includes(name) || options.nativeToolchain)
  )).map(name => 'tests/' + name).sort();
  files.push('tools/test-experience-entry.mjs', 'tools/test-responsive-build.mjs');
  return {
    files: [...files, ...pythonFiles],
    nodeFiles: files,
    pythonFiles,
    optionalNative: {
      art: options.nativeArt ? 'REQUESTED' : 'NOT_RUN',
      encoder: options.nativeToolchain ? 'REQUESTED' : 'NOT_RUN',
      reason: 'Native art ownership is macOS-only; encoder proof also requires installed optional modules.'
    }
  };
}

async function executeTests(root, options, plan, deadlineAt) {
  const durationMs = deadlineAt - Date.now();
  assert(durationMs > 0, 'Public test overall deadline has expired');
  const args = [
    '--test', '--experimental-test-isolation=none', '--test-timeout=60000',
    '--test-reporter=' + join(root, 'tools/public-test-reporter.mjs'),
    ...plan.files.map(file => join(root, file))
  ];
  const env = {
    ...process.env,
    HW_RUN_NATIVE_ART_TESTS: options.nativeArt ? '1' : '0',
    HW_RUN_NATIVE_ART_TOOLCHAIN_TESTS: options.nativeToolchain ? '1' : '0',
    HW_PUBLIC_TEST_ROOT: root,
    HW_PUBLIC_TEST_FILES: JSON.stringify(plan.files),
    HW_PUBLIC_TEST_OPTIONAL: JSON.stringify(plan.optionalNative),
    HW_PUBLIC_TEST_LAUNCHER_PID: String(process.pid),
    HW_PUBLIC_TEST_DEADLINE_AT: String(deadlineAt)
  };
  console.log('[public-test] Running ' + plan.files.length + ' required files; optional native scope is explicit.');
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: env,
    stdio: [ 'ignore', 'pipe', 'inherit' ]
  });
  let output = '';
  let pending = '';
  let outputBytes = 0;
  let failure;
  let forceTimer;
  const stop = (signal, code) => {
    if (failure) return;
    failure = Object.assign(Error('Public tests stopped: ' + signal), {
      exitCode: code
    });
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    forceTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 2500);
  };
  const handlers = {
    SIGINT: () => stop('SIGINT', 130),
    SIGTERM: () => stop('SIGTERM', 143)
  };
  for (const [name, handler] of Object.entries(handlers)) process.on(name, handler);
  const timer = setTimeout(() => stop('overall deadline', 124), durationMs);
  child.stdout.on('data', bytes => {
    outputBytes += bytes.length;
    if (outputBytes > 2 * 1024 * 1024) {
      stop('output ceiling', 1);
      child.kill('SIGKILL');
      return;
    }
    output += bytes;
    pending += bytes;
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('HEARTWOOD_PUBLIC_TEST_CHILD_RESULT ')) console.log(line);
    }
  });
  try {
    const closed = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({
        code: code,
        signal: signal
      }));
    });
    if (failure) throw failure;
    if (closed.signal === 'SIGKILL' && Date.now() >= deadlineAt) {
      throw Object.assign(Error('Public test child exceeded its independent deadline'), {
        exitCode: 124
      });
    }
    assert.equal(closed.code, 0, 'Public test process failed: ' + JSON.stringify(closed));
    const prefix = 'HEARTWOOD_PUBLIC_TEST_CHILD_RESULT ';
    const lines = output.split('\n').filter(line => line.startsWith(prefix));
    assert.equal(lines.length, 1, 'Exactly one complete public-test result is required');
    const result = validatePublicTestResult(JSON.parse(lines[0].slice(prefix.length)), plan.files);
    if (result.optionalNative.art === 'REQUESTED') result.optionalNative.art = 'PASS';
    if (result.optionalNative.encoder === 'REQUESTED') result.optionalNative.encoder = 'PASS';
    return result;
  } finally {
    clearTimeout(timer);
    clearTimeout(forceTimer);
    for (const [name, handler] of Object.entries(handlers)) process.removeListener(name, handler);
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = publicTestOptions(args);
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  const root = await realpath(join(import.meta.dirname, '..'));
  const plan = await publicTestPlan(root, options);
  const deadlineAt = Date.now() + (options.nativeArt ? 12e4 : 3e4);
  const results = [];
  // Separate files keep native ownership/env state independent. Each child runs
  // without Node's extra per-file worker processes, and shares one overall limit.
  for (const file of plan.nodeFiles) {
    results.push(await executeTests(root, options, {
      ...plan,
      files: [ file ]
    }, deadlineAt));
  }
  if (plan.pythonFiles.length > 0) {
    console.log('[public-test] Running ' + plan.pythonFiles.length + ' required Python files.');
    results.push(await executePublicPythonTests(root, plan, deadlineAt));
  }
  const sum = key => results.reduce((total, result) => total + result[key], 0);
  const result = {
    schema: 1,
    status: 'PASS',
    tests: sum('tests'),
    passed: sum('passed'),
    failed: 0,
    skipped: 0,
    mandatorySkipped: 0,
    mandatoryFiles: plan.files.length,
    todo: 0,
    roster: results.flatMap(row => row.roster),
    optionalNative: {
      ...plan.optionalNative
    },
    errors: []
  };
  if (options.nativeArt) result.optionalNative.art = 'PASS';
  if (options.nativeToolchain) result.optionalNative.encoder = 'PASS';
  validatePublicTestResult(result, plan.files);
  console.log('HEARTWOOD_PUBLIC_TEST_RESULT ' + JSON.stringify(result));
}

const invoked = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null;

if (invoked === await realpath(fileURLToPath(import.meta.url))) {
  try {
    await main();
  } catch (error) {
    console.error('[public-test] ' + error.message);
    process.exitCode = error.exitCode || 1;
  }
}
