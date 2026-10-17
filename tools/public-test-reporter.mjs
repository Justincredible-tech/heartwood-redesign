import { relative, sep } from 'node:path';

import { Worker } from 'node:worker_threads';

import { summarizePublicTests, normalizeNodeTestDirectives } from './public-test-results.mjs';

const watchdog = new Worker(new URL('./public-test-watchdog.mjs', import.meta.url), {
  workerData: {
    launcherPid: Number(process.env.HW_PUBLIC_TEST_LAUNCHER_PID),
    deadlineAt: Number(process.env.HW_PUBLIC_TEST_DEADLINE_AT)
  }
});

watchdog.on('error', error => {
  console.error('[public-test] Watchdog failed: ' + error.message);
  process.exit(1);
});

watchdog.unref();

export default async function* publicReporter(source) {
  const root = process.env.HW_PUBLIC_TEST_ROOT;
  const roster = JSON.parse(process.env.HW_PUBLIC_TEST_FILES || 'null');
  const optionalNative = JSON.parse(process.env.HW_PUBLIC_TEST_OPTIONAL || 'null');
  const events = [];
  for await (const event of source) {
    if (![ 'test:pass', 'test:fail' ].includes(event.type)) continue;
    const data = event.data;
    const file = typeof data.file === 'string' ? relative(root, data.file).split(sep).join('/') : null;
    const type = event.type === 'test:pass' ? 'pass' : 'fail';
    const flags = normalizeNodeTestDirectives(data);
    events.push({
      type: type,
      file: file,
      ...flags
    });
    const status = flags.skip ? 'SKIP' : flags.todo ? 'TODO' : type === 'pass' ? 'PASS' : 'FAIL';
    yield `[public-test] ${status} ${file || 'unknown file'}: ${data.name}\n`;
    if (type === 'fail') yield String(data.details?.error?.stack || data.details?.error || 'Test failed') + '\n';
  }
  const result = summarizePublicTests(roster, events, optionalNative);
  if (result.status !== 'PASS') process.exitCode = 1;
  yield 'HEARTWOOD_PUBLIC_TEST_CHILD_RESULT ' + JSON.stringify(result) + '\n';
}
