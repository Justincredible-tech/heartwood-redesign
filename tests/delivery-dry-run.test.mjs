import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {lstat} from 'node:fs/promises';

const api = await import('../tools/delivery-dry-run.mjs').catch(() => null);
const summary = () => ({schema: 1, status: 'PASS', tests: 7, passed: 7, failed: 0, skipped: 0, todo: 0,
  mandatorySkipped: 0, mandatoryFiles: 2,
  roster: [{file: 'tests/first.test.mjs', tests: 3, passed: 3, failed: 0, skipped: 0, todo: 0},
    {file: 'tests/second.test.mjs', tests: 4, passed: 4, failed: 0, skipped: 0, todo: 0}], errors: []});

test('the delivery gate has an explicit, bounded command line', () => {
  assert(api, 'delivery gate implementation is required');
  const options = api.parseArgs(['--repo', '.', '--receipt', 'receipt.json', '--offline']);
  assert.equal(options.offline, true);
  assert.equal(options.timeoutMs, 300000);
  assert.throws(() => api.parseArgs(['--bogus']), /Unknown/);
  assert.throws(() => api.parseArgs(['--timeout-ms', '0']), /timeout/);
  assert.throws(() => api.parseArgs(['--receipt']), /value/);
});

test('index membership rejects missing tests, private paths, symlinks and path aliases', () => {
  assert(api, 'delivery gate implementation is required');
  const hash = 'a'.repeat(40);
  const row = path => `100644 blob ${hash}\t${path}\0`;
  const files = api.readTreeListing(Buffer.from(row('tools/package.json') + row('tests/main.test.mjs')));
  assert.equal(files.length, 2);
  assert.throws(() => api.readTreeListing(Buffer.from(row('tools/package.json'))), /tests/);
  assert.throws(() => api.readTreeListing(Buffer.from(row('.audit/private.mjs'))), /private/);
  assert.throws(() => api.readTreeListing(Buffer.from(`120000 blob ${hash}\tlink\0`)), /regular/);
  assert.throws(() => api.readTreeListing(Buffer.from(row('../outside'))), /path/);
  assert.throws(() => api.readTreeListing(Buffer.from(row('Tools/A') + row('tools/a'))), /case/);
});

test('relative closure checks active imports and workers, not strings or comments', () => {
  assert(api, 'delivery gate implementation is required');
  const contents = new Map([
    ['tools/a.mjs', Buffer.from("import {x} from './b.mjs';\n" +
      "const worker = new URL('./worker.mjs', import.meta.url);\n" +
      "const example = \"import './not-real.mjs'\";\n// import './comment.mjs'\n")],
    ['tools/b.mjs', Buffer.from('export const x = 1;')],
    ['tools/worker.mjs', Buffer.from("await import('./b.mjs');")]
  ]);
  assert.equal(api.checkRelativeImports(contents).checked, 3);
  const missing = new Map(contents);
  missing.delete('tools/worker.mjs');
  assert.throws(() => api.checkRelativeImports(missing), /worker.mjs/);
  const escaped = new Map(contents);
  escaped.set('tools/a.mjs', Buffer.from("await import('../../outside.mjs');"));
  assert.throws(() => api.checkRelativeImports(escaped), /escape/);
});

test('directory URLs admit actual tree directories, repository roots and bounded generated report defaults', () => {
  const contents = new Map([
    ['tests/example.test.mjs', Buffer.from("const tools = new URL('../tools/', import.meta.url);\nconst root = new URL('../', import.meta.url);")],
    ['tests/optional/example.test.mjs', Buffer.from("const root = new URL('../../', import.meta.url);")],
    ['tools/example.mjs', Buffer.from("const siteRoot = new URL('../publish', import.meta.url);\n" +
      "const out = resolve(process.env.HW_OUT || new URL('../output/playwright/example', import.meta.url).pathname);\n" +
      "await mkdir(out, {recursive: true});")],
    ['tools/diagnostics/example.mjs', Buffer.from("const out=resolve(process.env.HW_OUT||new URL('../../output/playwright/example/details',import.meta.url).pathname);await mkdir(out,{recursive:true});")],
    ['publish/.htaccess', Buffer.from('# tracked publication configuration')]
  ]);
  assert.equal(api.checkRelativeImports(contents).checked, 6);
});

test('directory URL admission preserves strict import and worker file closure', () => {
  const fixtures = [
    "import './present-dir';", "export * from './present-dir';", "await import('./present-dir');", "import '../';",
    "new Worker(new URL('./worker', import.meta.url));",
    "new Worker(new URL('./present-dir/', import.meta.url));",
    "const dir = new URL('./missing-dir/', import.meta.url);",
    "const file = new URL('./missing.mjs', import.meta.url);",
    "const out=resolve(process.env.HW_OUT||new URL('../output/playwright/worker.mjs',import.meta.url).pathname);await mkdir(out,{recursive:true});",
    "const out=resolve(process.env.HW_OUT||new URL('../output/playwright/reports',import.meta.url).pathname);",
    "const out=resolve(new URL('../output/playwright/reports',import.meta.url).pathname);await mkdir(out,{recursive:true});",
    "const out=resolve(process.env.HW_OUT||new URL('../arbitrary/reports',import.meta.url).pathname);await mkdir(out,{recursive:true});",
    "const worker=new URL('../output/playwright/reports',import.meta.url);await mkdir(out,{recursive:true});"
  ];
  for (const source of fixtures) {
    const contents = new Map([['tools/example.mjs', Buffer.from(source)],
      ['tools/present-dir/file.mjs', Buffer.from('export const x = 1;')]]);
    assert.throws(() => api.checkRelativeImports(contents), /dependency|worker/i, source);
  }
});

test('relative URL closure rejects encoded escapes and separators while resolving ordinary URI filenames', () => {
  const contents = new Map([
    ['tools/example.mjs', Buffer.from("const file = new URL('./file%20name.mjs', import.meta.url);")],
    ['tools/file name.mjs', Buffer.from('export const x = 1;')]
  ]);
  assert.equal(api.checkRelativeImports(contents).checked, 1);
  for (const reference of ['../../outside.mjs', '../%2e%2e/outside.mjs', './bad%2fpath.mjs', './bad%5cpath.mjs', './bad%zz.mjs']) {
    contents.set('tools/example.mjs', Buffer.from(`const file=new URL('${reference}',import.meta.url);`));
    assert.throws(() => api.checkRelativeImports(contents), /escape|URI|separator/, reference);
  }
  const python = new Map([['tools/example.py', Buffer.from("path.with_name('file%20name.py')")],
    ['tools/file%20name.py', Buffer.from('# literal filesystem sibling')]]);
  assert.equal(api.checkRelativeImports(python).checked, 1);
  python.delete('tools/file%20name.py');
  python.set('tools/file name.py', Buffer.from('# different filesystem filename'));
  assert.throws(() => api.checkRelativeImports(python), /missing dependency/);
});

test('exit zero is insufficient without a nonempty public-test completion', () => {
  assert(api, 'delivery gate implementation is required');
  const valid = summary();
  assert.equal(api.admitPublicTestResult('HEARTWOOD_PUBLIC_TEST_RESULT ' + JSON.stringify(valid)).tests, 7);
  assert.throws(() => api.admitPublicTestResult(''), /completion/);
  for (const changes of [{tests: 0}, {failed: 1}, {skipped: 1}, {roster: []}, {status: 'FAIL'},
    {tests: 8}, {errors: ['crashed']}, {todo: 1}, {roster: [valid.roster[0], valid.roster[0]]}]) {
    assert.throws(() => api.admitPublicTestResult('HEARTWOOD_PUBLIC_TEST_RESULT ' +
      JSON.stringify({...valid, ...changes})));
  }
  assert.throws(() => api.admitPublicTestResult('HEARTWOOD_PUBLIC_TEST_RESULT {}\n' +
    'HEARTWOOD_PUBLIC_TEST_RESULT ' + JSON.stringify(valid)), /completion/);
});

test('delivery receipts bind the exact staged tree, parent and lockfile', () => {
  assert(api, 'delivery gate implementation is required');
  const binding = {tree: 'a'.repeat(40), head: 'b'.repeat(40), lockSha256: 'c'.repeat(64)};
  const receipt = {schema: 1, status: 'PASS', ...binding, cleanup: {status: 'CLEAN', errors: []},
    phases: ['npm-ci', 'build', 'public-tests', 'python-delivery'].map(name =>
      ({name, exitCode: 0, timedOut: false, durationMs: 1})),
    publicTests: summary(),
    pythonTests: 13, files: 8};
  assert.equal(api.verifyReceiptBinding(receipt, binding), true);
  for (const field of ['tree', 'head', 'lockSha256']) {
    assert.throws(() => api.verifyReceiptBinding({...receipt, [field]: 'different'}, binding), /binding/);
  }
  assert.throws(() => api.verifyReceiptBinding({...receipt, phases: []}, binding), /phase/);
  assert.throws(() => api.verifyReceiptBinding({...receipt, cleanup: {status: 'UNKNOWN'}}, binding), /cleanup/);
  assert.throws(() => api.verifyReceiptBinding({...receipt,
    cleanup: {status: 'CLEAN', errors: ['leftover process']}}, binding), /cleanup/);
  assert.throws(() => api.verifyReceiptBinding({...receipt, pythonTests: 0}, binding), /delivery/);
});

test('Python delivery requires an actual nonempty unittest completion', () => {
  assert(api, 'delivery gate implementation is required');
  assert.equal(api.admitPythonTestResult('Ran 13 tests in 0.100s\n\nOK\n'), 13);
  for (const output of ['', 'Ran 0 tests in 0.000s\n\nOK\n',
    'Ran 3 tests in 0.100s\n\nFAILED (failures=1)\n', 'Ran 3 tests in 0.100s\n\nOK (skipped=3)\n']) {
    assert.throws(() => api.admitPythonTestResult(output), /Python delivery/);
  }
});

test('a deliberately hanging owned process hits its deadline and is retired', {timeout: 10000}, async () => {
  assert(api, 'delivery gate implementation is required');
  const directory = await mkdtemp(join(tmpdir(), 'heartwood-delivery-test-'));
  const worker = join(directory, 'worker.mjs');
  await writeFile(worker, 'console.log(process.pid); setInterval(() => {}, 1000);\n');
  const runner = await api.createCommandRunner({timeoutMs: 5000});
  try {
    const result = await runner.run('hang-probe', process.execPath, [worker], {timeoutMs: 100});
    assert.equal(result.timedOut, true);
    assert.notEqual(result.exitCode, 0);
    const pid = Number(result.stdout.toString('utf8').trim());
    assert(Number.isInteger(pid) && pid > 0);
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  } finally {
    const cleanup = await runner.close();
    assert.equal(cleanup.status, 'CLEAN');
    await rm(directory, {recursive: true, force: true});
  }
});

test('bounded output and argv preserve failure instead of reporting success', {timeout: 10000}, async () => {
  assert(api, 'delivery gate implementation is required');
  const directory = await mkdtemp(join(tmpdir(), 'heartwood-delivery-test-'));
  const worker = join(directory, 'worker with spaces.mjs');
  await writeFile(worker, 'console.log(JSON.stringify(process.argv.slice(2))); process.exitCode = 7;\n');
  const runner = await api.createCommandRunner({timeoutMs: 5000});
  try {
    const result = await runner.run('argv-probe', process.execPath, [worker, 'value with spaces'], {timeoutMs: 1000});
    assert.equal(result.exitCode, 7);
    assert.deepEqual(JSON.parse(result.stdout), ['value with spaces']);
    await writeFile(worker, 'process.stdout.write("x".repeat(5000));\n');
    const excess = await runner.run('output-probe', process.execPath, [worker], {maxBytes: 1000, timeoutMs: 1000});
    assert.notEqual(excess.exitCode, 0);
    assert.match(excess.error, /output/);
  } finally {
    const cleanup = await runner.close();
    assert.equal(cleanup.status, 'CLEAN');
    await rm(directory, {recursive: true, force: true});
  }
});

test('the guardian cleans scratch and workers after controller process-group death', {timeout: 12000}, async () => {
  assert(api, 'delivery gate implementation is required');
  const directory = await mkdtemp(join(tmpdir(), 'heartwood-delivery-test-'));
  const launcher = join(directory, 'launcher.mjs');
  const worker = join(directory, 'worker.mjs');
  const moduleUrl = new URL('../tools/delivery-dry-run.mjs', import.meta.url).href;
  await writeFile(worker, 'console.log(process.pid); setInterval(() => {}, 1000);\n');
  await writeFile(launcher, `import {createCommandRunner} from ${JSON.stringify(moduleUrl)};
const runner = await createCommandRunner({timeoutMs: 10000});
const scratch = await runner.makeScratch();
const task = runner.start('owned-worker', process.execPath, [${JSON.stringify(worker)}], {
  timeoutMs: 10000, onOutput: (_, bytes) => console.log(JSON.stringify({scratch, pid: Number(bytes)}))
});
await task.result;
await runner.close();
`);
  const child = spawn(process.execPath, [launcher], {
    stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32'
  });
  let owned;
  let scratchIdentity;
  try {
    owned = await new Promise((yes, no) => {
      let output = '';
      let errors = '';
      const timer = setTimeout(() => no(Error('Owned launcher did not start')), 4000);
      child.stderr.on('data', bytes => {errors += bytes;});
      child.stdout.on('data', bytes => {
        output += bytes;
        if (output.includes('\n')) {clearTimeout(timer); yes(JSON.parse(output.trim()));}
      });
      child.once('exit', code => {clearTimeout(timer); no(Error(`Launcher exited ${code}: ${errors}`));});
    });
    scratchIdentity = await lstat(owned.scratch);
    assert(scratchIdentity.isDirectory());
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
    for (let count = 0; count < 100; count++) {
      const present = await lstat(owned.scratch).then(() => true, error => error.code !== 'ENOENT');
      if (!present) break;
      await new Promise(done => setTimeout(done, 25));
    }
    await assert.rejects(lstat(owned.scratch), {code: 'ENOENT'});
    assert.throws(() => process.kill(owned.pid, 0), /ESRCH/);
  } finally {
    child.kill('SIGKILL');
    // These exact resources were created by this fixture; failed assertions must not leak them.
    if (owned) {
      try {process.kill(owned.pid, 'SIGKILL');} catch (error) {if (error.code !== 'ESRCH') throw error;}
      const current = await lstat(owned.scratch).catch(error => {
        if (error.code === 'ENOENT') return null; throw error;
      });
      if (current) {
        assert(current.dev === scratchIdentity.dev && current.ino === scratchIdentity.ino);
        await rm(owned.scratch, {recursive: true, force: false});
      }
    }
    await rm(directory, {recursive: true, force: true});
  }
});
