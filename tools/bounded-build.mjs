// Portable stdlib CPU deadline + independent inode/marker scratch guardian.
import { Worker } from 'node:worker_threads';

import { fork } from 'node:child_process';

import { lstat, realpath } from 'node:fs/promises';

import { resolve, dirname, sep } from 'node:path';

import { fileURLToPath, pathToFileURL } from 'node:url';

import { randomUUID } from 'node:crypto';

import assert from 'node:assert/strict';

import { writeOutput, canonicalBuildPath } from './build-output.mjs';

import { admitForegroundLauncher, watchForegroundLauncher } from './foreground-launcher.mjs';

import { admitBoundedResult } from './bounded-build-result.mjs';

import { cleanupBuildScratch } from './bounded-build-guard.mjs';

const bound = async (label, work, ms) => {
  let timer;
  try {
    return await Promise.race([ Promise.resolve().then(work), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('stuck at ' + label + ' after ' + ms + 'ms')), ms);
    }) ]);
  } finally {
    clearTimeout(timer);
  }
};

export function outputOverlapsInputs(out, projectRoot, pathApi = {
  resolve: resolve,
  sep: sep
}) {
  const target = pathApi.resolve(out), root = pathApi.resolve(projectRoot);
  return target === root || [ 'source', 'tools', '.git', '.audit', 'site', 'evidence' ].some(part => {
    const input = pathApi.resolve(root, part);
    return target === input || target.startsWith(input + pathApi.sep);
  });
}

async function scratchParent(out) {
  let cursor = await canonicalBuildPath(out);
  for (let depth = 0; depth < 128; depth++) {
    try {
      const info = await lstat(cursor);
      assert(info.isDirectory() && !info.isSymbolicLink() && await realpath(cursor) === cursor, 'Build output ancestor must be canonical directory');
      return cursor;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const next = dirname(cursor);
    assert(next !== cursor, 'No existing output ancestor');
    cursor = next;
  }
  throw Error('Build output ancestor depth exceeds128');
}

export async function runBoundedBuild({entry: entry, method: method = 'buildMobile', args: args = [], out: out, projectRoot: projectRoot, useWriter: useWriter = true, timeoutMs: timeoutMs = 6e4, onStep: onStep = () => {}} = {}) {
  assert(typeof entry === 'string' && entry.startsWith('file:') && typeof method === 'string' && Array.isArray(args) && typeof out === 'string' && typeof projectRoot === 'string' && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 6e4, 'Invalid bounded build options');
  out = await canonicalBuildPath(out);
  projectRoot = await realpath(resolve(projectRoot));
  entry = pathToFileURL(await realpath(fileURLToPath(entry))).href;
  if (args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    args = [ {
      ...args[0]
    }, ...args.slice(1) ];
    if (typeof args[0].out === 'string') args[0].out = await canonicalBuildPath(args[0].out);
    if (typeof args[0].sourceRoot === 'string') args[0].sourceRoot = await realpath(resolve(args[0].sourceRoot));
  }
  assert(!outputOverlapsInputs(out, projectRoot), 'Bounded build output overlaps protected inputs');
  const launcherPid = admitForegroundLauncher(process.platform, process.ppid);
  const token = randomUUID(), controller = new AbortController, writes = new Set;
  let guard, worker, wholeTimer, forceTimer, step = 'start guardian', received = false, guardClosed, resolveGuard, rejectGuard, resolveReady, rejectReady, stop, resolveGuardExit, ownership;
  const ready = new Promise((r, j) => {
    resolveReady = r;
    rejectReady = j;
  }), closed = new Promise((r, j) => {
    resolveGuard = r;
    rejectGuard = j;
  });
  closed.catch(() => {});
  const guardExit = new Promise(r => {
    resolveGuardExit = r;
  });
  let resolveResult, rejectResult, resolveWorkerExit;
  const result = new Promise((r, j) => {
    resolveResult = r;
    rejectResult = j;
  }), workerExit = new Promise(r => {
    resolveWorkerExit = r;
  });
  result.catch(() => {});
  const fail = (reason, code = 1) => {
    if (stop) return;
    stop = {
      reason: reason,
      code: code
    };
    controller.abort(reason);
    rejectResult(reason);
    forceTimer = setTimeout(() => {
      console.error('[build] shutdown exceeded8s: ' + reason.message);
      process.exit(code);
    }, 8e3);
  };
  const releaseLauncher = watchForegroundLauncher({
    parentPid: launcherPid,
    getStep: () => step,
    onRetire: fail
  });
  const signals = [ [ 'SIGINT', 130 ], [ 'SIGTERM', 143 ], [ 'SIGHUP', 129 ] ].map(([signal, code]) => {
    const fn = () => fail(Object.assign(Error('build stopped by ' + signal), {
      exitCode: code
    }), code);
    process.once(signal, fn);
    return [ signal, fn ];
  });
  try {
    wholeTimer = setTimeout(() => fail(Object.assign(Error('stuck at ' + step + '; whole build exceeded ' + timeoutMs + 'ms'), {
      exitCode: 124
    }), 124), timeoutMs);
    onStep(step);
    const parent = await bound('select same-filesystem build scratch', () => scratchParent(out), 5e3);
    if (stop) throw stop.reason;
    guard = fork(fileURLToPath(new URL('./bounded-build-guard.mjs', import.meta.url)), [], {
      stdio: [ 'ignore', 'inherit', 'inherit', 'ipc' ],
      detached: process.platform !== 'win32'
    });
    guard.on('message', message => {
      if (message?.type === 'ready') resolveReady(message); else if (message?.type === 'closed') {
        guardClosed = true;
        const clean = message.token === token && message.cleanup?.status === 'CLEAN' && Array.isArray(message.cleanup.errors) && message.cleanup.errors.length === 0 && Number.isInteger(message.code);
        if (!clean || message.code !== 0 && !stop) {
          const error = Object.assign(Error('build guardian cleanup failed: ' + JSON.stringify(message)), {
            exitCode: message.code || 125
          });
          rejectReady(error);
          rejectGuard(error);
          fail(error, error.exitCode);
        } else resolveGuard(message);
      } else if (message?.type === 'error') {
        const error = Object.assign(Error(message.message), {
          exitCode: message.code || 1
        });
        rejectReady(error);
        fail(error, error.exitCode);
      }
    });
    guard.once('error', error => {
      rejectReady(error);
      rejectGuard(error);
      fail(error);
    });
    guard.once('exit', (code, signal) => {
      resolveGuardExit({
        code: code,
        signal: signal
      });
      if (!guardClosed) {
        const error = Error('build guardian exited before cleanup: ' + code);
        rejectReady(error);
        rejectGuard(error);
        fail(error);
      }
    });
    guard.send({
      type: 'init',
      parent: parent,
      token: token
    });
    ownership = await bound('guardian scratch registration', () => ready, 5e3);
    assert(ownership.token === token && ownership.record?.token === token && ownership.record.path === ownership.path && ownership.record.dev === ownership.dev && ownership.record.ino === ownership.ino && ownership.record.parent === parent, 'Build guardian ownership changed');
    if (stop) throw stop.reason;
    const scratch = ownership.path;
    step = 'guardian scratch ready';
    onStep(step, ownership);
    worker = new Worker(new URL('./bounded-build-worker.mjs', import.meta.url), {
      workerData: {
        entry: entry,
        method: method,
        args: args,
        useWriter: useWriter
      }
    });
    worker.on('message', message => {
      if (message?.type === 'step') {
        step = message.step;
        onStep(step);
        return;
      }
      if (message?.type === 'result') {
        try {
          assert(!received, 'Duplicate bounded build result');
          const admitted = admitBoundedResult(method, message.result, {
            summary: true
          });
          if (method === 'buildMobile') assert(resolve(admitted.out) === out, 'Phone result output changed');
          received = true;
          resolveResult(admitted);
        } catch (error) {
          fail(error);
        }
        return;
      }
      if (message?.type === 'failure') {
        fail(Object.assign(Error(message.message), {
          stack: message.stack
        }));
        return;
      }
      if (message?.type !== 'write') return;
      const task = (async () => {
        assert(useWriter && !stop && message.out === out && typeof message.path === 'string' && (message.bytes instanceof Uint8Array || typeof message.bytes === 'string'), 'Invalid output request for ' + message.path);
        assert(Buffer.byteLength(message.bytes) <= 8 * 1024 * 1024, 'Worker output exceeds8MiB');
        step = 'write ' + message.path;
        await writeOutput(out, message.path, message.bytes, {
          temporaryRoot: scratch,
          signal: controller.signal
        });
        if (!stop) worker.postMessage({
          id: message.id
        });
      })().catch(error => {
        if (!stop) worker.postMessage({
          id: message.id,
          error: error.message
        });
        fail(error);
      }).finally(() => writes.delete(task));
      writes.add(task);
    });
    worker.once('error', fail);
    worker.once('exit', code => {
      resolveWorkerExit(code);
      if (!received && !stop) fail(Error('Build worker exited without a result: ' + code));
    });
    return await result;
  } catch (error) {
    fail(error, error.exitCode || 1);
    throw error;
  } finally {
    clearTimeout(wholeTimer);
    controller.abort(stop?.reason || Error('build complete'));
    const errors = [];
    let cleanupIncomplete = false;
    if (worker) {
      if (!stop) try {
        const code = await bound('normal build worker exit', () => workerExit, 2500);
        assert.equal(code, 0, 'Build worker crashed after its result');
      } catch (error) {
        errors.push(error);
      }
      try {
        await bound('terminate build worker', () => worker.terminate(), 2500);
      } catch (error) {
        errors.push(error);
        cleanupIncomplete = true;
      }
    }
    try {
      await bound('drain parent-owned atomic writes', () => Promise.all([ ...writes ]), 2e3);
    } catch (error) {
      errors.push(error);
      cleanupIncomplete = true;
    }
    if (guard) {
      try {
        if (guard.connected) await bound('request independent scratch cleanup', () => new Promise((r, j) => guard.send({
          type: 'close'
        }, error => error ? j(error) : r())), 500);
        await bound('independent scratch cleanup', () => closed, 3e3);
      } catch (error) {
        errors.push(error);
        try {
          if (guard.connected) guard.disconnect();
        } catch {}
      }
      try {
        const exit = await bound('actual scratch guardian retirement', () => guardExit, 1e3);
        assert(exit.code === 0 || stop && Number.isInteger(exit.code) && exit.code !== 0, 'Scratch guardian crashed after closure');
      } catch (error) {
        errors.push(error);
        let guardianPending = true;
        try {
          guard.kill('SIGKILL');
          await bound('actual owned guardian forced retirement', () => guardExit, 250);
          guardianPending = false;
        } catch (retirementError) {
          errors.push(retirementError);
        }
        cleanupIncomplete ||= guardianPending;
      }
      if (ownership && !cleanupIncomplete) try {
        await bound('controller known admitted scratch retirement', () => cleanupBuildScratch(ownership.record), 1e3);
      } catch (error) {
        errors.push(error);
      }
    }
    if (process.platform !== 'win32' && process.ppid !== launcherPid) fail(Object.assign(Error('build launcher retired during cleanup: parent ' + launcherPid + ' became ' + process.ppid), {
      exitCode: 143
    }), 143);
    releaseLauncher();
    for (const [signal, fn] of signals) process.removeListener(signal, fn);
    if (!cleanupIncomplete) clearTimeout(forceTimer);
    if (errors.length) throw Object.assign(new AggregateError(errors, 'Build cleanup failed'), {
      exitCode: stop?.code || 125
    });
    if (stop) throw stop.reason;
  }
}
