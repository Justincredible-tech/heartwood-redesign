// Optional Mac filesystem case/symlink/supervisor checks; requested unsupported hosts fail explicitly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, readdir, rm, symlink, rename, lstat } from 'node:fs/promises';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import * as output from '../tools/build-output.mjs';
import { scratchParent } from '../tools/whole-build-ownership.mjs';
import { readCompressionInput } from '../tools/compress-site.mjs';
import { runWholeBuild } from '../tools/whole-build.mjs';
import { runBoundedBuild } from '../tools/bounded-build.mjs';

import { nativeArtTestState } from './fixtures/native-art-test-support.mjs';

const nativeState = nativeArtTestState();

async function fixture(t) {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'heartwood-paths-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await mkdir(join(folder, 'Project'));
  return folder;
}

test('caller path spelling is normalized before strict scratch admission', { timeout: 2000, skip: nativeState.enabled ? false : nativeState.reason }, async t => {
  const folder = await fixture(t);
  const actual = join(folder, 'Project');
  const varied = join(folder, 'PROJECT');
  let equivalent = false;
  try { equivalent = await realpath(varied) === actual; } catch {}
  if (!equivalent) {
    assert.fail('UNSUPPORTED: requested native case-alias check requires a case-insensitive filesystem');
    return;
  }
  assert.equal(await scratchParent(join(varied, 'not-yet-created')), actual);
});

test('compression accepts case variants of the same regular file', { timeout: 2000, skip: nativeState.enabled ? false : nativeState.reason }, async t => {
  const folder = await fixture(t);
  const file = join(folder, 'Project', 'page.html');
  await writeFile(file, '<p>same bytes</p>');
  const varied = join(folder, 'PROJECT', 'PAGE.HTML');
  let equivalent = false;
  try { equivalent = await realpath(varied) === file; } catch {}
  if (!equivalent) { assert.fail('UNSUPPORTED: requested native case-alias check requires a case-insensitive filesystem'); return; }
  assert.deepEqual(await readCompressionInput(varied), Buffer.from('<p>same bytes</p>'));
});

test('compression still rejects a final-file symlink', { timeout: 2000, skip: nativeState.enabled ? false : nativeState.reason }, async t => {
  const folder = await fixture(t);
  const file = join(folder, 'Project', 'page.html');
  await writeFile(file, 'original');
  try { await symlink(file, join(folder, 'page-link.html')); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      assert.fail('UNSUPPORTED: requested native symlink check needs unprivileged symlink support'); return;
    }
    throw error;
  }
  await assert.rejects(readCompressionInput(join(folder, 'page-link.html')));
});

test('a protected input case alias is rejected before any output directory is created', { timeout: 2000, skip: nativeState.enabled ? false : nativeState.reason }, async t => {
  const folder = await fixture(t), actual = join(folder, 'Project'), varied = join(folder, 'PROJECT');
  let equivalent = false;
  try { equivalent = await realpath(varied) === actual; } catch {}
  if (!equivalent) { assert.fail('UNSUPPORTED: requested native case-alias check requires a case-insensitive filesystem'); return; }
  await mkdir(join(actual, 'source'));
  await assert.rejects(output.ensureOutputDirectory(join(varied, 'source', 'new-output'), {
    root: actual, protectedPaths: [join(actual, 'source')],
  }), /protected input/);
  assert.deepEqual(await readdir(join(actual, 'source')), []);
});

test('an inert supervised job accepts root spelling aliases and retires its scratch', { timeout: 10000, skip: nativeState.enabled ? false : nativeState.reason }, async t => {
  const folder = await fixture(t), actual = join(folder, 'Project'), varied = join(folder, 'PROJECT');
  let equivalent = false;
  try { equivalent = await realpath(varied) === actual; } catch {}
  if (!equivalent) { assert.fail('UNSUPPORTED: requested native case-alias check requires a case-insensitive filesystem'); return; }
  await mkdir(join(actual, 'tools'));
  const job = join(actual, 'tools', 'job.mjs');
  await writeFile(job, "import {join} from 'node:path';\n" +
    "export async function buildSite({root,writer}){await writer(join(root,'publish'),'result.txt','exact');return {generated:['result.txt']};}\n");
  const result = await runWholeBuild({ entry: pathToFileURL(join(varied, 'tools', 'job.mjs')).href,
    projectRoot: varied, out: join(varied, 'publish'), options: { root: varied }, timeoutMs: 3000, phaseMs: 1000 });
  assert.deepEqual(result, { generated: ['result.txt'] });
  assert.equal(await readFile(join(actual, 'publish', 'result.txt'), 'utf8'), 'exact');
  assert.deepEqual((await readdir(actual)).sort(), ['publish', 'tools']);
});

test('a bounded planning job normalizes caller output arguments and retires its scratch', { timeout: 10000, skip: nativeState.enabled ? false : nativeState.reason }, async t => {
  const folder = await fixture(t), actual = join(folder, 'Project'), varied = join(folder, 'PROJECT');
  let equivalent = false;
  try { equivalent = await realpath(varied) === actual; } catch {}
  if (!equivalent) { assert.fail('UNSUPPORTED: requested native case-alias check requires a case-insensitive filesystem'); return; }
  await mkdir(join(actual, 'tools'));
  await writeFile(join(actual, 'tools', 'job.mjs'),
    'export async function describeArtRegeneration({out}){return {plan:[],photos:[],browserRequired:false,scope:out};}\n');
  const result = await runBoundedBuild({
    entry: pathToFileURL(join(varied, 'tools', 'job.mjs')).href, method: 'describeArtRegeneration',
    projectRoot: varied, out: join(varied, 'publish'), args: [{ out: join(varied, 'publish') }],
    useWriter: false, timeoutMs: 3000,
  });
  assert.equal(result.scope, join(actual, 'publish'));
  assert.deepEqual(await readdir(actual), ['tools']);
});

async function nativeOutputFixture(t) {
  const folder = await fixture(t), project = join(folder, 'Project');
  const source = join(project, 'source'), out = join(project, 'publish/mobile');
  await mkdir(source);
  await writeFile(join(source, 'keep.txt'), 'author');
  return { folder, project, source, out };
}

async function nativeSymlink(target, link, type) {
  try { await symlink(target, link, type); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      assert.fail('UNSUPPORTED: requested native output check needs unprivileged symlinks');
    }
    throw error;
  }
}

test('phone output rejects a source symlink ancestor without modifying its referent', {
  timeout: 3000, skip: nativeState.enabled ? false : nativeState.reason,
}, async t => {
  const { project, source, out } = await nativeOutputFixture(t);
  await mkdir(dirname(out));
  await nativeSymlink(source, out, 'dir');
  await assert.rejects(output.ensureOutputDirectory(out, { root: project, protectedPaths: [source] }),
    /real directory|protected input/);
  assert.deepEqual(await readdir(source), ['keep.txt']);
  assert.equal(await readFile(join(source, 'keep.txt'), 'utf8'), 'author');
});

test('phone output rejects a linked asset folder without writing into its referent', {
  timeout: 3000, skip: nativeState.enabled ? false : nativeState.reason,
}, async t => {
  const { source, out } = await nativeOutputFixture(t);
  await output.ensureOutputDirectory(out);
  await nativeSymlink(source, join(out, 'assets'), 'dir');
  await assert.rejects(output.writeOutput(out, 'assets/new.txt', 'build'), /real directory|protected input/);
  assert.deepEqual(await readdir(source), ['keep.txt']);
  assert.equal(await readFile(join(source, 'keep.txt'), 'utf8'), 'author');
});

test('phone output rejects a linked file target without replacing author bytes', {
  timeout: 3000, skip: nativeState.enabled ? false : nativeState.reason,
}, async t => {
  const { source, out } = await nativeOutputFixture(t);
  await output.ensureOutputDirectory(out);
  await nativeSymlink(join(source, 'keep.txt'), join(out, 'day.html'));
  await assert.rejects(output.writeOutput(out, 'day.html', 'build'), /regular file|protected input/);
  assert.deepEqual(await readdir(source), ['keep.txt']);
  assert.equal(await readFile(join(source, 'keep.txt'), 'utf8'), 'author');
  assert.deepEqual(await readdir(out), ['day.html']);
});

async function copyBuildModules(from, to) {
  const copied = new Set();
  let bytesCopied = 0;
  async function copy(path) {
    const file = resolve(from, path);
    assert(file.startsWith(from + sep), 'Fixture module escaped the public project');
    if (copied.has(file)) return;
    assert(copied.size < 64, 'Fixture module closure exceeds64files');
    const before = await lstat(file), bytes = await readFile(file), after = await lstat(file);
    assert(before.isFile() && !before.isSymbolicLink() && before.dev === after.dev && before.ino === after.ino &&
      before.size === bytes.length && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
    'Public fixture module changed while copying');
    bytesCopied += bytes.length;
    assert(bytesCopied <= 2 * 1024 * 1024, 'Fixture module closure exceeds2MiB');
    copied.add(file);
    const destination = join(to, relative(from, file));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: 'wx' });
    const imports = [...bytes.toString().matchAll(
      /\b(?:import|export)\s+(?:[^;'"`]*?\s+from\s*)?(['"])(\.[^'"]+)\1/g
    )].map(match => match[2]);
    for (const specifier of imports) await copy(relative(from, resolve(dirname(file), specifier)));
  }
  await copy('tools/build-site.mjs');
  return { files: copied.size, bytes: bytesCopied };
}

async function sourceSnapshot(source) {
  const rows = [];
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      assert(rows.length < 128 && !entry.isSymbolicLink(), 'Unexpected fixture source entry');
      const file = join(folder, entry.name), path = relative(source, file);
      if (entry.isDirectory()) { rows.push([path, 'directory']); await walk(file); }
      else {
        assert(entry.isFile(), 'Unexpected nonregular fixture source');
        rows.push([path, createHash('sha256').update(await readFile(file)).digest('hex')]);
      }
    }
  }
  await walk(source);
  return rows.sort((a, b) => a[0].localeCompare(b[0]));
}

test('the actual default build CLI refuses publish linked to source before authored inputs or outputs', {
  timeout: 10000, skip: nativeState.enabled ? false : nativeState.reason,
}, async t => {
  const { project, source } = await nativeOutputFixture(t);
  const current = await realpath(resolve(import.meta.dirname, '..'));
  const copied = await copyBuildModules(current, project);
  assert(copied.files > 0 && copied.bytes > 0);
  // Reuse already-installed code dependencies; the owned link is removed with the fixture.
  await nativeSymlink(await realpath(join(current, 'tools/node_modules')),
    join(project, 'tools/node_modules'), 'dir');
  await nativeSymlink(source, join(project, 'publish'), 'dir');
  const before = await sourceSnapshot(source);
  await assert.rejects(promisify(execFile)(process.execPath, [join(project, 'tools/build-site.mjs')], {
    timeout: 8000, maxBuffer: 65536,
  }), error => error.code === 1 && !error.killed && !error.signal && /protected input/.test(error.stderr));
  assert.deepEqual(await sourceSnapshot(source), before);
  assert.equal(await readFile(join(source, 'keep.txt'), 'utf8'), 'author');
  assert((await lstat(join(project, 'publish'))).isSymbolicLink());
  assert.deepEqual((await readdir(project)).sort(), ['publish', 'source', 'tools']);
});
