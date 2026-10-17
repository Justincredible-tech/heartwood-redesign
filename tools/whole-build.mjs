import { fork } from 'node:child_process';

import { resolve, join, sep } from 'node:path';

import { fileURLToPath, pathToFileURL } from 'node:url';

import { canonicalBuildPath } from './build-output.mjs';

import { realpath } from 'node:fs/promises';

import { randomUUID } from 'node:crypto';

import assert from 'node:assert/strict';
import {resolveBuildFeatures} from '../source/build-features.mjs';

import { bound, scratchParent, verifyScratch, cleanupScratch } from './whole-build-ownership.mjs';

import { admitForegroundLauncher, watchForegroundLauncher } from './foreground-launcher.mjs';

export { admitForegroundLauncher } from './foreground-launcher.mjs';

export async function isActualMain(url, argv = process.argv) {
  if (!argv[1]) return false;
  try {
    return await realpath(fileURLToPath(url)) === await realpath(resolve(argv[1]));
  } catch {
    return false;
  }
}

export {parseFeatureFlags as parseBuildFlags} from '../source/build-features.mjs';

export async function runWholeBuild({entry: entry, method: method = 'buildSite', out: out, projectRoot: projectRoot, options: options = {}, timeoutMs: timeoutMs = 3e5, phaseMs: phaseMs = 12e4, onStep: onStep = () => {}, onOwnership: onOwnership = () => {}} = {}) {
  assert(Number(process.versions.node.split('.')[0]) >= 22, 'Public build requires Node22 or newer');
  assert(typeof entry === 'string' && entry.startsWith('file:') && typeof method === 'string' && typeof out === 'string' && typeof projectRoot === 'string' && options && typeof options === 'object' && !Array.isArray(options) && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 3e5 && Number.isInteger(phaseMs) && phaseMs > 0 && phaseMs <= 12e4, 'Invalid whole build options');
  // Validate explicit feature policy before allocating a worker or output directory.
  if (options.exclude !== undefined) options = {...options, exclude:[...resolveBuildFeatures(options.exclude).excluded]};
  out = await canonicalBuildPath(out);
  projectRoot = await realpath(resolve(projectRoot));
  entry = pathToFileURL(await realpath(fileURLToPath(entry))).href;
  options = {
    ...options
  };
  for (const key of [ 'out', 'publish' ]) if (typeof options[key] === 'string') options[key] = await canonicalBuildPath(options[key]);
  if (typeof options.root === 'string') options.root = await realpath(resolve(options.root));
  assert(out !== projectRoot && ![ 'source', 'tools', '.git', '.audit', 'site', 'evidence' ].some(name => out === join(projectRoot, name) || out.startsWith(join(projectRoot, name) + sep)), 'Build output overlaps inputs');
  const token = randomUUID();
  let guardian, record, closed, stopped, timer, last = 'select scratch parent', resolveReady, rejectReady, resolveClosed, rejectClosed, resolveExit;
  const ready = new Promise((r, j) => {
    resolveReady = r;
    rejectReady = j;
  }), result = new Promise((r, j) => {
    resolveClosed = r;
    rejectClosed = j;
  }), exit = new Promise(r => {
    resolveExit = r;
  });
  ready.catch(() => {});
  result.catch(() => {});
  const fail = (message, code = 1) => {
    if (stopped) return;
    stopped = {
      message: message,
      code: code
    };
    rejectReady(Object.assign(Error(message), {
      exitCode: code
    }));
    rejectClosed(Object.assign(Error(message), {
      exitCode: code
    }));
    if (guardian?.connected) guardian.disconnect();
  };
  const launcherPid = admitForegroundLauncher(process.platform, process.ppid), releaseLauncher = watchForegroundLauncher({
    parentPid: launcherPid,
    getStep: () => last,
    onRetire: (error, code) => fail(error.message, code)
  });
  const signals = [ [ 'SIGINT', 130 ], [ 'SIGTERM', 143 ], [ 'SIGHUP', 129 ] ].map(([signal, code]) => {
    const fn = () => fail('build stopped by ' + signal + ' at ' + last, code);
    process.once(signal, fn);
    return [ signal, fn ];
  });
  try {
    const parent = await bound(last, () => scratchParent(out), 2500);
    if (stopped) throw Object.assign(Error(stopped.message), {
      exitCode: stopped.code
    });
    last = 'guardian startup';
    guardian = fork(fileURLToPath(new URL('./whole-build-guard.mjs', import.meta.url)), [], {
      stdio: [ 'ignore', 'inherit', 'inherit', 'ipc' ],
      detached: process.platform !== 'win32'
    });
    guardian.on('message', message => {
      if (message?.type === 'ready') {
        if (message.record?.token !== token) {
          fail('Guardian ownership token mismatch', 125);
          return;
        }
        record = message.record;
        resolveReady(record);
      } else if (message?.type === 'step' && message.token === token) {
        last = message.step;
        onStep(last);
      } else if (message?.type === 'closed' && message.token === token) {
        closed = message;
        if (!record) rejectReady(Object.assign(Error(message.message), {
          exitCode: message.code || 125
        }));
        resolveClosed(message);
      }
    });
    guardian.once('error', error => fail('Guardian launch failed: ' + error.message));
    guardian.once('exit', (code, signal) => {
      resolveExit({
        code: code,
        signal: signal
      });
      if (!closed) fail('Guardian exited without cleanup receipt: ' + (signal || code), 125);
    });
    guardian.send({
      type: 'init',
      token: token,
      parent: parent,
      entry: entry,
      method: method,
      out: out,
      projectRoot: projectRoot,
      options: options,
      timeoutMs: timeoutMs,
      phaseMs: phaseMs
    }, error => {
      if (error) fail('Guardian admission failed: ' + error.message);
    });
    await bound('guardian scratch admission', () => ready, 3e3);
    await bound('verify scratch ownership', () => verifyScratch(record), 1500);
    onOwnership({
      ...record,
      guardianPid: guardian.pid
    });
    if (stopped) throw Object.assign(Error(stopped.message), {
      exitCode: stopped.code
    });
    timer = setTimeout(() => fail('stuck at ' + last + '; controller whole deadline exceeded', 124), timeoutMs + 1e3);
    const final = await result;
    assert(final.cleanup?.status === 'CLEAN' && Array.isArray(final.cleanup.errors) && final.cleanup.errors.length === 0, 'Whole build cleanup failed: ' + final.message);
    if (final.code !== 0) throw Object.assign(Error(final.message), {
      exitCode: final.code
    });
    assert(final.result && typeof final.result === 'object', 'Whole build had no result');
    return final.result;
  } catch (error) {
    fail(error.message, error.exitCode || 1);
    throw error;
  } finally {
    clearTimeout(timer);
    const errors = [], cleanupStep = step => {
      last = step;
      try {
        onStep(last);
      } catch (error) {
        errors.push(error);
      }
    };
    if (guardian) {
      cleanupStep('retire whole build guardian');
      if (stopped && guardian.connected) guardian.disconnect();
      try {
        const retired = await bound('whole build guardian exit', () => exit, 8500);
        if (!stopped && (retired.code !== 0 || retired.signal)) errors.push(Error('Guardian crashed after completion: ' + (retired.signal || retired.code)));
      } catch (error) {
        errors.push(error);
        if (guardian.exitCode === null && guardian.signalCode === null) guardian.kill('SIGKILL');
        try {
          await bound('owned guardian force retirement', () => exit, 500);
        } catch (error) {
          errors.push(error);
        }
      }
    }
    cleanupStep('controller admitted scratch cleanup');
    try {
      await bound('controller admitted scratch cleanup', () => cleanupScratch(record), 1e3);
    } catch (error) {
      errors.push(error);
    }
    if (process.platform !== 'win32' && process.ppid !== launcherPid) fail('build launcher retired: parent ' + launcherPid + ' became ' + process.ppid + ' at ' + last, 143);
    releaseLauncher();
    for (const [signal, fn] of signals) process.removeListener(signal, fn);
    if (errors.length) throw Object.assign(new AggregateError(errors, 'Whole build shutdown failed'), {
      exitCode: 125
    });
    if (stopped) throw Object.assign(Error(stopped.message), {
      exitCode: stopped.code
    });
  }
}
