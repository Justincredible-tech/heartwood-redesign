// Build and test exactly what Git will commit, without borrowing working-tree files.
import assert from 'node:assert/strict';
import {fork, spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {access, chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {get} from 'node:http';
import {tmpdir} from 'node:os';
import {delimiter, dirname, join, posix, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validatePublicTestResult} from './public-test-results.mjs';

const SELF = fileURLToPath(import.meta.url);
const HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const MAX_TREE_BYTES = 128 * 1024 * 1024;
const PUBLIC_RESULT = 'HEARTWOOD_PUBLIC_TEST_RESULT ';
const REQUIRED_PHASES = ['npm-ci', 'build', 'public-tests', 'python-delivery'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(done => setTimeout(done, ms));

export function parseArgs(args) {
  const options = {repo: process.cwd(), timeoutMs: 300000, python: 'python', pythonArgs: [], offline: false,
    baseline: 'refs/remotes/upstream/main'};
  const values = new Map([
    ['--repo', 'repo'], ['--receipt', 'receipt'], ['--timeout-ms', 'timeoutMs'],
    ['--python', 'python'], ['--npm-cli', 'npmCli'], ['--python-arg', 'pythonArgs'], ['--baseline', 'baseline']
  ]);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--help') options.help = true;
    else if (flag === '--offline') options.offline = true;
    else if (values.has(flag)) {
      const value = args[++index];
      assert(typeof value === 'string' && value.length > 0 && !value.includes('\0'), `${flag} requires a value`);
      if (flag === '--python-arg') options.pythonArgs.push(value);
      else options[values.get(flag)] = value;
    } else throw Error(`Unknown delivery-dry-run argument: ${flag}`);
  }
  options.timeoutMs = Number(options.timeoutMs);
  assert(Number.isInteger(options.timeoutMs) && options.timeoutMs >= 1000 && options.timeoutMs <= 600000,
    'Delivery timeout must be an integer from 1000 to 600000 ms');
  assert(!options.baseline.startsWith('-') && !/[\s\0]/.test(options.baseline), 'Invalid upstream baseline ref');
  if (!options.help) assert(options.receipt, '--receipt requires a value');
  return options;
}

export function readTreeListing(bytes) {
  const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  const names = new Set();
  const folded = new Set();
  const files = text.split('\0').filter(Boolean).map(row => {
    const match = /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/.exec(row);
    assert(match, 'Delivery tree must contain only regular Git blobs (no symlinks or submodules)');
    const [, mode, object, path] = match;
    const parts = path.split('/');
    assert(!/[\\\r\n\0]/.test(path) && parts.every(part => part && part !== '.' && part !== '..'),
      `Invalid delivery path: ${JSON.stringify(path)}`);
    assert(!parts.some(part => ['.audit', 'node_modules', '.git'].includes(part.toLowerCase())),
      `Delivery tree contains a private/generated dependency path: ${path}`);
    assert(!names.has(path) && !folded.has(path.toLowerCase()), `Duplicate or case-colliding delivery path: ${path}`);
    names.add(path);
    folded.add(path.toLowerCase());
    return {mode, object, path};
  });
  assert(files.length > 0 && files.length <= 10000, 'Delivery tree must contain 1..10000 files');
  assert(files.some(file => /^tests\/[^/]+\.test\.mjs$/.test(file.path)), 'Delivery tree has no public tests');
  return files;
}

function codePositions(source, python) {
  const mask = source.split('');
  let quote = null;
  let block = false;
  let line = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (line) {
      mask[index] = ' ';
      if (char === '\n') line = false;
    } else if (block) {
      mask[index] = ' ';
      if (char === '*' && next === '/') {mask[++index] = ' '; block = false;}
    } else if (quote) {
      mask[index] = ' ';
      if (char === '\\') {if (index + 1 < source.length) mask[++index] = ' ';}
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || !python && char === '`') {
      quote = char;
      mask[index] = ' ';
    } else if (python && char === '#' || !python && char === '/' && next === '/') {
      line = true;
      mask[index] = ' ';
    } else if (!python && char === '/' && next === '*') {
      block = true;
      mask[index] = ' ';
      mask[++index] = ' ';
    }
  }
  return mask.join('');
}

function dependencyTarget(path, reference, python = false) {
  if (python) {
    const target = posix.normalize(posix.join(posix.dirname(path), reference));
    assert(target !== '..' && !target.startsWith('../'), 'dependency escapes tree');
    return target;
  }
  assert(!/[\\]/.test(reference) && !/%(?:2f|5c)/i.test(reference),
    'URI dependency contains an encoded/path separator');
  const root = '/__heartwood_delivery__/';
  const base = 'file://' + root + path.split('/').map(encodeURIComponent).join('/');
  const decoded = decodeURIComponent(new URL(reference, base).pathname);
  assert(decoded.startsWith(root), 'dependency escapes tree');
  return decoded.slice(root.length);
}

function generatedReportDirectory(target, source, mask, match) {
  // A URL alone cannot waive a missing dependency. This one generated category
  // is explicitly an HW_OUT directory default, inside the bounded report tree,
  // and its named destination must actually be created as a directory.
  if (target.length > 240 || target.split('/').length > 8 ||
      !/^output\/playwright\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\/?$/.test(target)) return false;
  const before = mask.slice(Math.max(0, match.index - 160), match.index);
  const declaration = /(?:^|[;\n])\s*const\s+(out|outputDir|reportDir)\s*=\s*resolve\(\s*process\.env\.HW_OUT\s*\|\|\s*$/.exec(before);
  if (!declaration || !/^\s*\.pathname\s*\)/.test(source.slice(match.index + match[0].length))) return false;
  const name = declaration[1];
  return new RegExp('\\bmkdir\\s*\\(\\s*' + name + '\\s*,\\s*\\{\\s*recursive\\s*:\\s*true\\s*\\}\\s*\\)').test(mask);
}

export function checkRelativeImports(contents) {
  let checked = 0;
  const errors = [];
  for (const [path, bytes] of contents) {
    if (!/\.(?:m?js|py)$/.test(path)) continue;
    const source = bytes.toString('utf8');
    const mask = codePositions(source, path.endsWith('.py'));
    const patterns = path.endsWith('.py')
      ? [{kind: 'file', pattern: /\bwith_name\(\s*(['"])([^'"\r\n]+\.(?:py|mjs))\1\s*\)/g}]
      : [
        {kind: 'file', pattern: /\b(?:import|export)\s+(?:[\w*{},\s]+?\s+from\s+)?(['"])(\.{1,2}\/[^'"\r\n]*)\1/g},
        {kind: 'file', pattern: /\bimport\s*\(\s*(['"])(\.{1,2}\/[^'"\r\n]*)\1\s*\)/g},
        {kind: 'url', pattern: /\bnew\s+URL\s*\(\s*(['"])(\.{1,2}\/[^'"\r\n]*)\1\s*,\s*import\.meta\.url\s*\)/g}
      ];
    for (const {kind, pattern} of patterns) for (const match of source.matchAll(pattern)) {
      if (mask[match.index] === ' ') continue;
      const reference = match[2].split(/[?#]/, 1)[0];
      checked++;
      let target;
      try {target = dependencyTarget(path, reference, path.endsWith('.py'));}
      catch (error) {errors.push(`${path}: invalid URI dependency ${reference}: ${error.message}`); continue;}
      if (contents.has(target)) continue;
      if (kind === 'url') {
        const prefix = mask.slice(Math.max(0, match.index - 100), match.index);
        const worker = /\b(?:new\s+(?:Worker|SharedWorker)|fork)\s*\(\s*$/.test(prefix);
        const directory = target.replace(/\/$/, '');
        const exists = [...contents.keys()].some(file => directory === '' || file.startsWith(directory + '/'));
        if (!worker && (exists || generatedReportDirectory(target, source, mask, match))) continue;
      }
      errors.push(`${path}: missing dependency ${target || '.'}`);
    }
  }
  assert.equal(errors.length, 0, 'Public dependency closure failed:\n' + errors.join('\n'));
  return {checked, scope: 'literal relative files, import-meta URLs with proven directories or typed report defaults, and Python siblings'};
}

export function admitPublicTestResult(output) {
  const lines = output.split(/\r?\n/).filter(line => line.startsWith(PUBLIC_RESULT));
  assert.equal(lines.length, 1, 'Public tests must emit exactly one completion record');
  const result = JSON.parse(lines[0].slice(PUBLIC_RESULT.length));
  assert(Array.isArray(result.roster) && result.roster.length > 0, 'Public tests have no mandatory roster');
  const roster = result.roster.map(row => row.file);
  assert(roster.every(file => typeof file === 'string' && file.length > 0) && new Set(roster).size === roster.length,
    'Duplicate or missing public test membership');
  validatePublicTestResult(result, roster);
  return {...result, mandatoryFiles: roster.length, mandatorySkipped: result.skipped};
}

export function admitPythonTestResult(output) {
  const completions = [...output.matchAll(/^Ran (\d+) tests? in [\d.]+s\r?\n\s*\r?\nOK\s*$/gm)];
  assert(completions.length === 1 && Number(completions[0][1]) > 0 &&
    !/\b(?:FAILED|skipped=|Traceback)\b/.test(output), 'Python delivery did not complete nonempty tests');
  return Number(completions[0][1]);
}

export function verifyReceiptBinding(receipt, binding) {
  assert(receipt.schema === 1 && receipt.status === 'PASS', 'Delivery receipt is not a completed pass');
  for (const field of ['tree', 'lockSha256', 'baselineCommit', 'publicTestRosterSha256', 'gateSha256', 'head']) {
    if (binding[field] === undefined && !['tree', 'lockSha256'].includes(field)) continue;
    assert.equal(receipt[field], binding[field], `Delivery receipt binding differs: ${field}`);
  }
  assert(receipt.cleanup?.status === 'CLEAN' && Array.isArray(receipt.cleanup.errors) &&
    receipt.cleanup.errors.length === 0, 'Delivery cleanup was not verified clean');
  assert(Array.isArray(receipt.phases), 'Missing delivery phases');
  for (const name of REQUIRED_PHASES) {
    const rows = receipt.phases.filter(row => row.name === name);
    assert(rows.length === 1 && rows[0].exitCode === 0 && rows[0].timedOut === false &&
      Number.isFinite(rows[0].durationMs) && rows[0].durationMs >= 0, `Delivery phase did not complete: ${name}`);
  }
  admitPublicTestResult(PUBLIC_RESULT + JSON.stringify(receipt.publicTests));
  assert(Number.isInteger(receipt.pythonTests) && receipt.pythonTests > 0, 'Python delivery tests were empty');
  assert(Number.isInteger(receipt.files) && receipt.files > 0, 'Delivery membership was empty');
  return true;
}

export function publicTestRosterSha256(contents) {
  const rows = [...contents.keys()].filter(path => path.startsWith('tests/') || path.startsWith('tools/test-'))
    .sort().map(path => `${path}\0${sha256(contents.get(path))}\n`);
  assert(rows.length > 0, 'Public test roster is empty');
  return sha256(rows.join(''));
}

function processAlive(pid, group = false) {
  try {process.kill(group ? -pid : pid, 0); return true;}
  catch (error) {if (error.code === 'ESRCH') return false; throw error;}
}

function signalGroup(pid, signal) {
  try {process.kill(-pid, signal);} catch (error) {if (error.code !== 'ESRCH') throw error;}
}

async function retireProcess(child) {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === 'win32') {
    if (!processAlive(pid)) return;
    await new Promise((done, fail) => {
      const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'});
      const timer = setTimeout(() => {killer.kill(); fail(Error('taskkill exceeded 2000 ms'));}, 2000);
      killer.once('error', error => {clearTimeout(timer); fail(error);});
      killer.once('exit', code => {
        clearTimeout(timer);
        if (code !== 0 && processAlive(pid)) fail(Error(`taskkill failed for owned PID ${pid}: ${code}`));
        else done();
      });
    });
  } else if (processAlive(pid, true)) {
    signalGroup(pid, 'SIGTERM');
    for (let count = 0; count < 10 && processAlive(pid, true); count++) await sleep(25);
    if (processAlive(pid, true)) signalGroup(pid, 'SIGKILL');
  }
  for (let count = 0; count < 40; count++) {
    if (!processAlive(pid, process.platform !== 'win32')) return;
    await sleep(25);
  }
  throw Error(`Owned process ${pid} did not retire`);
}

async function runGuardian() {
  assert(process.send, 'Delivery guardian requires a private IPC channel');
  const tasks = new Map();
  const leftovers = new Map();
  let scratch = null;
  let scratchWork;
  let closing = false;
  const send = message => {
    if (process.connected) process.send(message, error => {if (error && !closing) void close();});
  };
  const close = async () => {
    if (closing) return;
    closing = true;
    clearTimeout(watchdog);
    const failClosed = setTimeout(() => process.exit(125), 8000);
    const errors = [];
    for (const task of tasks.values()) {
      try {await retireProcess(task.child);} catch (error) {errors.push(error.message);}
      await task.done;
    }
    for (const child of leftovers.values()) {
      try {await retireProcess(child);} catch (error) {errors.push(error.message);}
    }
    if (scratchWork) try {await scratchWork;} catch (error) {errors.push(error.message);}
    if (scratch) try {
      const current = await lstat(scratch.path);
      assert(current.isDirectory() && !current.isSymbolicLink() && current.dev === scratch.dev &&
        current.ino === scratch.ino, 'Owned delivery temp directory identity changed');
      await rm(scratch.path, {recursive: true, force: false, maxRetries: 3, retryDelay: 100});
    } catch (error) {if (error.code !== 'ENOENT') errors.push(error.message);}
    send({kind: 'closed', cleanup: {status: errors.length ? 'UNKNOWN' : 'CLEAN', errors}});
    if (errors.length) console.error('[delivery guardian] cleanup failed: ' + errors.join('; '));
    clearTimeout(failClosed);
    if (process.connected) process.disconnect();
  };
  const watchdog = setTimeout(() => {
    console.error('[delivery guardian] deadline expired; stuck at ' +
      [...tasks.values()].map(task => task.name).join(', ') + ', waiting on owned subprocesses');
    void close();
  }, Number(process.argv[3]));
  process.on('disconnect', close);
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  process.on('message', message => {
    if (message.kind === 'close') {void close(); return;}
    if (message.kind === 'make-scratch' && !closing) {
      scratchWork = (async () => {
        assert(!scratch, 'Delivery scratch directory was already created');
        const path = await realpath(await mkdtemp(join(tmpdir(), 'heartwood-delivery-')));
        const stat = await lstat(path);
        scratch = {path, dev: stat.dev, ino: stat.ino};
        send({kind: 'scratch-ready', path});
      })();
      scratchWork.catch(error => send({kind: 'scratch-error', error: error.message}));
      return;
    }
    if (message.kind === 'stop') {
      const task = tasks.get(message.id);
      if (task) {
        task.stopped = true;
        void retireProcess(task.child).catch(error => {task.error = error.message;});
      }
      return;
    }
    if (message.kind !== 'run' || closing) return;
    const started = Date.now();
    const stdout = [];
    const stderr = [];
    let count = 0;
    const child = spawn(message.command, message.args, {
      cwd: message.cwd, env: message.env, stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32', windowsHide: true
    });
    let completed;
    const task = {child, name: message.name, error: null, timedOut: false,
      done: new Promise(yes => {completed = yes;})};
    tasks.set(message.id, task);
    const stop = error => {
      task.error ||= error;
      void retireProcess(child).catch(failure => {task.error += '; ' + failure.message;});
    };
    const timer = setTimeout(() => {task.timedOut = true; stop('command deadline exceeded');}, message.timeoutMs);
    for (const [stream, chunks, name] of [[child.stdout, stdout, 'stdout'], [child.stderr, stderr, 'stderr']]) {
      stream.on('data', bytes => {
        count += bytes.length;
        if (count > message.maxBytes) {stop('command output limit exceeded'); return;}
        chunks.push(bytes);
        send({kind: 'output', id: message.id, stream: name, bytes: bytes.toString('base64')});
      });
    }
    child.stdin.on('error', () => {});
    child.once('error', error => {task.error = error.message;});
    child.once('close', async (code, signal) => {
      clearTimeout(timer);
      try {await retireProcess(child);} catch (error) {
        task.error ||= error.message;
        if (child.pid) leftovers.set(child.pid, child);
      }
      tasks.delete(message.id);
      send({kind: 'result', id: message.id, result: {
        exitCode: task.timedOut ? 124 : task.error ? 125 : code ?? (signal === 'SIGINT' ? 130 : 143),
        pid: child.pid, signal, stopped: !!task.stopped, timedOut: task.timedOut,
        error: task.error, durationMs: Date.now() - started,
        stdout: Buffer.concat(stdout).toString('base64'), stderr: Buffer.concat(stderr).toString('base64')
      }});
      completed();
    });
    child.stdin.end(message.input ? Buffer.from(message.input, 'base64') : undefined);
  });
  send({kind: 'ready'});
}

export async function createCommandRunner({timeoutMs = 300000} = {}) {
  assert(Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 600000, 'Invalid command-runner timeout');
  const guardian = fork(SELF, ['--delivery-guardian', String(timeoutMs)], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true, execArgv: [],
    detached: process.platform !== 'win32'
  });
  const pending = new Map();
  let ready;
  let closed;
  let scratchReady;
  let closePromise;
  let closeResolve;
  let overall;
  let exitResolve;
  const exited = new Promise(yes => {exitResolve = yes;});
  const startup = new Promise((yes, no) => {ready = {yes, no};});
  guardian.on('message', message => {
    if (message.kind === 'ready') ready.yes();
    else if (message.kind === 'scratch-ready') scratchReady?.yes(message.path);
    else if (message.kind === 'scratch-error') scratchReady?.no(Error(message.error));
    else if (message.kind === 'closed') {clearTimeout(overall); closed = message.cleanup; closeResolve?.(closed);}
    else if (message.kind === 'output') {
      const task = pending.get(message.id);
      task?.onOutput?.(message.stream, Buffer.from(message.bytes, 'base64'));
    } else if (message.kind === 'result') {
      const task = pending.get(message.id);
      pending.delete(message.id);
      task?.resolve({...message.result, stdout: Buffer.from(message.result.stdout, 'base64'),
        stderr: Buffer.from(message.result.stderr, 'base64')});
    }
  });
  const unavailable = error => {
    clearTimeout(overall);
    ready.no(error);
    scratchReady?.no(error);
    for (const task of pending.values()) task.reject(error);
    pending.clear();
    if (!closed) {closed = {status: 'UNKNOWN', errors: [error.message]}; closeResolve?.(closed);}
  };
  guardian.once('error', unavailable);
  guardian.once('exit', code => {
    exitResolve(code);
    if (!closed) unavailable(Error(`Delivery guardian exited without cleanup: ${code}`));
  });
  const startupTimer = setTimeout(() => {
    guardian.kill('SIGKILL');
    ready.no(Error('Delivery guardian startup timed out'));
  }, 3000);
  await startup.finally(() => clearTimeout(startupTimer));
  const close = () => {
    if (closePromise) return closePromise;
    const completion = closed ? Promise.resolve(closed) : new Promise(yes => {closeResolve = yes;});
    if (!closed) guardian.send({kind: 'close'});
    const timer = setTimeout(() => {
      closed = {status: 'UNKNOWN', errors: ['Delivery cleanup/guardian exit exceeded 9000 ms']};
      guardian.kill('SIGKILL');
      unavailable(Error(closed.errors[0]));
      closeResolve?.(closed);
    }, 9000);
    closePromise = completion.then(async () => {await exited; return closed;})
      .finally(() => {clearTimeout(timer); clearTimeout(overall);});
    return closePromise;
  };
  overall = setTimeout(close, timeoutMs);
  const start = (name, command, args, options = {}) => {
    assert(!closed && !closePromise, 'Delivery command runner is closed');
    const id = randomUUID();
    const result = new Promise((yes, no) => pending.set(id, {
      resolve: yes, reject: no, onOutput: options.onOutput
    }));
    guardian.send({kind: 'run', id, name, command, args, cwd: options.cwd, env: options.env ?? process.env,
      timeoutMs: options.timeoutMs ?? 10000, maxBytes: options.maxBytes ?? 4 * 1024 * 1024,
      input: options.input?.toString('base64')});
    return {result, stop: () => guardian.send({kind: 'stop', id})};
  };
  return {
    start, run: (name, command, args, options) => start(name, command, args, options).result, close,
    makeScratch: () => new Promise((yes, no) => {
      assert(!scratchReady && !closed && !closePromise, 'Delivery scratch request unavailable');
      scratchReady = {yes, no};
      guardian.send({kind: 'make-scratch'});
    })
  };
}

async function npmCli(explicit) {
  const candidates = [explicit, process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')];
  for (const path of (process.env.PATH ?? '').split(delimiter)) {
    candidates.push(join(path, 'npm'), join(path, 'node_modules/npm/bin/npm-cli.js'));
  }
  for (const candidate of candidates.filter(Boolean)) try {
    const actual = await realpath(candidate);
    if (actual.endsWith('npm-cli.js')) {await access(actual); return actual;}
  } catch {}
  throw Error('Cannot locate npm-cli.js; specify --npm-cli (commands never use a shell)');
}

function batchBlobs(output, objects) {
  const contents = new Map();
  let offset = 0;
  for (const object of objects) {
    const newline = output.indexOf(10, offset);
    assert(newline >= 0, 'Incomplete Git blob batch header');
    const match = /^([a-f0-9]{40}|[a-f0-9]{64}) blob (\d+)$/.exec(output.subarray(offset, newline).toString('ascii'));
    assert(match && match[1] === object, 'Git returned an unexpected or missing blob');
    const size = Number(match[2]);
    assert(Number.isSafeInteger(size) && size <= MAX_TREE_BYTES, 'Git blob exceeds delivery limit');
    offset = newline + 1;
    assert(offset + size < output.length && output[offset + size] === 10, 'Incomplete Git blob batch body');
    contents.set(object, output.subarray(offset, offset + size));
    offset += size + 1;
  }
  assert.equal(offset, output.length, 'Unexpected trailing Git blob data');
  return contents;
}

function requestBytes(url) {
  return new Promise((yes, no) => {
    const request = get(url, {timeout: 3000}, response => {
      const chunks = [];
      let length = 0;
      response.on('data', bytes => {
        length += bytes.length;
        if (length > 8 * 1024 * 1024) response.destroy(Error('Preview response exceeds limit'));
        else chunks.push(bytes);
      });
      response.once('error', no);
      response.once('end', () => yes({status: response.statusCode,
        headers: response.headers, bytes: Buffer.concat(chunks)}));
    });
    request.once('timeout', () => request.destroy(Error('Preview request timed out')));
    request.once('error', no);
  });
}

const PREVIEW_RUNNER = [
  'import sys', 'from pathlib import Path', 'sys.path.insert(0, str(Path(sys.argv[1])))',
  'from preview import PreviewHandler, ThreadingHTTPServer',
  "server = ThreadingHTTPServer(('127.0.0.1', 0), PreviewHandler)", 'server.daemon_threads = True',
  "print('HEARTWOOD_DELIVERY_PREVIEW ' + str(server.server_address[1]), flush=True)",
  'try:', '    server.serve_forever()', 'finally:', '    server.server_close()', ''
].join('\n');

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log('Usage: node tools/delivery-dry-run.mjs --receipt FILE [--repo DIR] [--offline]\n' +
      '  [--python EXECUTABLE] [--python-arg ARG] [--npm-cli FILE] [--timeout-ms 300000] [--baseline REF]\n' +
      'Validates the exact Git index with locked npm install, default build, public tests and Python delivery.\n' +
      'No browser, deploy, ref changes, index changes, global cache deletion or source mutations.');
    return;
  }
  const repo = await realpath(resolve(options.repo));
  const receiptPath = resolve(options.receipt);
  try {await lstat(receiptPath); throw Error('Receipt path already exists; use a fresh filename');}
  catch (error) {if (error.code !== 'ENOENT') throw error;}
  const runner = await createCommandRunner({timeoutMs: options.timeoutMs});
  const receipt = {schema: 1, status: 'FAIL', startedAt: new Date().toISOString(), phases: []};
  const phaseResults = new Map();
  const deadline = Date.now() + options.timeoutMs;
  let failure;
  let stopped;
  const environment = {...process.env, PATH: dirname(process.execPath) + delimiter + process.env.PATH,
    PYTHONDONTWRITEBYTECODE: '1'};
  for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'PYTHONPATH', 'PYTHONHOME']) delete environment[key];
  const execute = async (name, command, argv, extra = {}) => {
    receipt.lastStep = name;
    console.log(`[delivery] ${name}: starting`);
    const result = await runner.run(name, command, argv, {
      cwd: repo, env: environment, ...extra,
      timeoutMs: Math.min(extra.timeoutMs ?? 10000, Math.max(1, deadline - Date.now()))
    });
    receipt.phases.push({name, pid: result.pid, exitCode: result.exitCode,
      timedOut: result.timedOut, durationMs: result.durationMs,
      stdoutSha256: sha256(result.stdout), stderrSha256: sha256(result.stderr)});
    phaseResults.set(name, result);
    console.log(`[delivery] ${name}: exit ${result.exitCode}, ${result.durationMs} ms`);
    if (result.exitCode !== 0) throw Error(`${name} failed (exit ${result.exitCode}): ${result.error ??
      (result.stderr.length ? result.stderr : result.stdout).toString('utf8').slice(-4000)}`);
    return result.stdout;
  };
  const git = (name, argv, extra) => execute(name, 'git', ['--no-replace-objects', ...argv], extra);
  const signal = name => () => {
    stopped = Object.assign(Error(`Delivery stopped by ${name}`), {exitCode: name === 'SIGINT' ? 130 : 143});
    void runner.close();
  };
  const interrupt = signal('SIGINT');
  const terminate = signal('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  const hardStop = setTimeout(() => {
    console.error(`[delivery] whole-run deadline exceeded; stuck at ${receipt.lastStep}; stopping owned processes`);
    void runner.close().finally(() => process.exit(124));
  }, options.timeoutMs);
  try {
    await git('staged-whitespace', ['diff', '--cached', '--check']);
    receipt.head = (await git('read-head', ['rev-parse', '--verify', 'HEAD'])).toString('utf8').trim();
    receipt.tree = (await git('read-index', ['write-tree'])).toString('utf8').trim();
    receipt.baselineCommit = (await git('read-upstream-baseline', ['rev-parse', '--verify',
      `${options.baseline}^{commit}`])).toString('utf8').trim();
    assert(HASH.test(receipt.head) && HASH.test(receipt.tree) && HASH.test(receipt.baselineCommit),
      'Invalid Git tree, upstream or parent identity');
    const files = readTreeListing(await git('list-index-tree', ['ls-tree', '-rz', '--full-tree', receipt.tree]));
    const objects = [...new Set(files.map(file => file.object))];
    const blobs = batchBlobs(await git('read-index-blobs', ['cat-file', '--batch'], {
      input: Buffer.from(objects.join('\n') + '\n'), maxBytes: MAX_TREE_BYTES, timeoutMs: 30000
    }), objects);
    const contents = new Map(files.map(file => [file.path, blobs.get(file.object)]));
    for (const path of ['tools/package.json', 'tools/package-lock.json', 'tools/build-site.mjs',
      'tools/build-mobile.mjs', 'tools/test-public.mjs', 'tools/test-delivery.py', 'tools/preview.py']) {
      assert(contents.has(path), `Required public delivery file is absent from index: ${path}`);
    }
    receipt.files = files.length;
    receipt.lockSha256 = sha256(contents.get('tools/package-lock.json'));
    receipt.publicTestRosterSha256 = publicTestRosterSha256(contents);
    receipt.gateSha256 = contents.has('tools/delivery-dry-run.mjs')
      ? sha256(contents.get('tools/delivery-dry-run.mjs')) : null;
    assert(receipt.gateSha256 === sha256(await readFile(SELF)), 'Invoked delivery gate differs from staged gate');
    receipt.closure = checkRelativeImports(contents);
    const scratch = await runner.makeScratch();
    const checkout = join(scratch, 'checkout');
    await mkdir(checkout);
    receipt.lastStep = 'extract-index-files';
    for (const file of files) {
      assert(Date.now() < deadline, 'Delivery deadline expired during extraction');
      const target = join(checkout, ...file.path.split('/'));
      await mkdir(dirname(target), {recursive: true});
      await writeFile(target, contents.get(file.path), {flag: 'wx'});
      if (file.mode === '100755') await chmod(target, 0o755);
    }
    const tools = join(checkout, 'tools');
    const cli = await npmCli(options.npmCli);
    await execute('npm-ci', process.execPath, [cli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund',
      ...(options.offline ? ['--offline'] : [])], {cwd: tools, timeoutMs: 90000});
    assert.equal(sha256(await readFile(join(tools, 'package-lock.json'))), receipt.lockSha256, 'npm changed lockfile');
    await execute('build', process.execPath, [cli, 'run', 'build'], {cwd: tools, timeoutMs: 30000});
    const tests = await execute('public-tests', process.execPath, [cli, 'test'], {
      cwd: tools, timeoutMs: 60000,
      env: {...environment, HW_PUBLIC_TEST_PYTHON: options.python,
        HW_PUBLIC_TEST_PYTHON_ARGS: JSON.stringify(options.pythonArgs)}
    });
    receipt.publicTests = admitPublicTestResult(tests.toString('utf8'));
    const previewFile = join(scratch, 'preview-runner.py');
    await writeFile(previewFile, PREVIEW_RUNNER, {flag: 'wx'});
    let previewOutput = '';
    let portResolve;
    let portReject;
    const portReady = new Promise((yes, no) => {portResolve = yes; portReject = no;});
    const preview = runner.start('python-preview', options.python, [...options.pythonArgs, previewFile, tools], {
      cwd: tools, env: environment, timeoutMs: Math.min(70000, Math.max(1, deadline - Date.now())),
      onOutput: (stream, bytes) => {
        if (stream !== 'stdout') return;
        previewOutput += bytes.toString('utf8');
        const match = /^HEARTWOOD_DELIVERY_PREVIEW (\d+)$/m.exec(previewOutput);
        if (match) portResolve(Number(match[1]));
      }
    });
    preview.result.then(result => portReject(Error('Python preview stopped before delivery: ' +
      result.stderr.toString('utf8').slice(-2000))), portReject);
    const portTimer = setTimeout(() => portReject(Error('Python preview startup exceeded 5000 ms')), 5000);
    let port;
    try {port = await portReady;} finally {clearTimeout(portTimer);}
    assert(Number.isInteger(port) && port > 0 && port <= 65535, 'Invalid owned preview port');
    const manifest = JSON.parse(await readFile(join(tools, 'build-manifest.json'), 'utf8'));
    assert(Array.isArray(manifest.generated) && manifest.generated.length > 0 && manifest.assets?.html,
      'Default build produced no delivery manifest');
    const url = `http://127.0.0.1:${port}/`;
    const served = await requestBytes(url + manifest.assets.html);
    assert(served.status === 200 && served.headers['x-heartwood-preview'] === '1', 'Wrong preview served delivery');
    assert.equal(sha256(served.bytes), sha256(await readFile(join(checkout, 'publish', manifest.assets.html))),
      'Preview served bytes from another build');
    await execute('python-delivery', options.python,
      [...options.pythonArgs, join(tools, 'test-delivery.py')], {
        cwd: tools, env: {...environment, HEARTWOOD_PREVIEW: url}, timeoutMs: 60000
      });
    // unittest writes its completion to stderr; inspect it rather than accepting an empty stdout.
    const delivery = phaseResults.get('python-delivery');
    receipt.pythonTests = admitPythonTestResult(delivery.stdout.toString('utf8') + delivery.stderr.toString('utf8'));
    preview.stop();
    const previewStopped = await preview.result;
    assert(previewStopped.stopped && !previewStopped.timedOut && !previewStopped.error,
      'Owned preview failed or exceeded its deadline');
    receipt.headAfter = (await git('read-head-after', ['rev-parse', '--verify', 'HEAD'])).toString('utf8').trim();
    receipt.treeAfter = (await git('read-index-after', ['write-tree'])).toString('utf8').trim();
    assert.equal(receipt.treeAfter, receipt.tree, 'Staged tree changed during delivery');
    assert(!stopped, stopped?.message);
    receipt.status = 'PASS';
  } catch (error) {failure = error; receipt.error = error.message;}
  finally {
    receipt.cleanup = await runner.close();
    clearTimeout(hardStop);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  }
  if (stopped) {receipt.status = 'FAIL'; receipt.error = stopped.message; failure = stopped;}
  receipt.finishedAt = new Date().toISOString();
  if (receipt.cleanup.status !== 'CLEAN') {receipt.status = 'FAIL'; failure ||= Error('Delivery cleanup incomplete');}
  if (!failure) try {verifyReceiptBinding(receipt, receipt);} catch (error) {
    receipt.status = 'FAIL'; receipt.error = error.message; failure = error;
  }
  const receiptTimer = setTimeout(() => {
    console.error('[delivery] stuck writing final receipt; 3000 ms deadline expired');
    process.exit(125);
  }, 3000);
  try {await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx', mode: 0o600});}
  finally {clearTimeout(receiptTimer);}
  console.log(`[delivery] ${receipt.status}: ${receiptPath}`);
  if (failure) throw failure;
  return receipt;
}

const actualMain = process.argv[1] && await realpath(process.argv[1]).catch(() => null) === await realpath(SELF);
if (actualMain) {
  const operation = process.argv[2] === '--delivery-guardian' ? runGuardian() : main();
  operation.catch(error => {console.error('[delivery] ' + error.message); process.exitCode = error.exitCode || 1;});
}
