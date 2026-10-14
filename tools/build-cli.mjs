// Small in-process CLI limits. Normal builds start no workers, watchers or browsers.
import { realpath } from 'node:fs/promises';

import { resolve } from 'node:path';

import { fileURLToPath } from 'node:url';

import { writeOutput } from './build-output.mjs';

export async function isBuildMain(url) {
  if (!process.argv[1]) return false;
  try {
    return await realpath(fileURLToPath(url)) === await realpath(resolve(process.argv[1]));
  } catch {
    return false;
  }
}

export {parseFeatureFlags as parseBuildFlags} from '../source/build-features.mjs';

export async function runBuildCommand(name, work, {timeoutMs: timeoutMs = 12e4} = {}) {
  if (typeof work !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12e4) {
    throw new Error('Build deadline must be an integer from 1 to 120000 ms');
  }
  const controller = new AbortController;
  let step = 'starting', timer, forceExit, settled = false;
  const stop = (message, code) => {
    if (controller.signal.aborted) return;
    console.error('[build] ' + message + ' at ' + step);
    process.exitCode = code;
    controller.abort(Object.assign(new Error(message), {
      exitCode: code
    }));
    // An unresponsive filesystem call cannot keep the command alive indefinitely.
        forceExit = setTimeout(() => process.exit(code), 2e3);
  };
  const signals = [ [ 'SIGINT', 130 ], [ 'SIGTERM', 143 ], [ 'SIGHUP', 129 ] ].map(([signal, code]) => {
    const listener = () => stop('stopped by ' + signal, code);
    process.once(signal, listener);
    return [ signal, listener ];
  });
  const onStep = value => {
    if (controller.signal.aborted) throw controller.signal.reason;
    step = value;
    console.log('[build:' + name + '] ' + step);
  };
  const writer = (out, path, bytes) => writeOutput(out, path, bytes, {
    signal: controller.signal
  });
  const cancelled = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
      once: true
    });
  });
  const job = Promise.resolve().then(() => work({
    onStep: onStep,
    writer: writer,
    signal: controller.signal
  }));
  job.then(() => {
    settled = true;
  }, () => {
    settled = true;
  });
  timer = setTimeout(() => stop('deadline exceeded (' + timeoutMs + ' ms)', 124), timeoutMs);
  try {
    return await Promise.race([ job, cancelled ]);
  } finally {
    clearTimeout(timer);
    for (const [signal, listener] of signals) process.removeListener(signal, listener);
    // Cancelled work has a short, bounded opportunity to close its descriptors.
        if (controller.signal.aborted) {
      let grace;
      await Promise.race([ job.catch(() => {}), new Promise(done => {
        grace = setTimeout(done, 1500);
      }) ]);
      clearTimeout(grace);
      if (settled) clearTimeout(forceExit);
    } else clearTimeout(forceExit);
  }
}
