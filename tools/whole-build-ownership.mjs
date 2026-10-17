import { constants } from 'node:fs';

import { lstat, realpath, open, opendir, unlink, rmdir } from 'node:fs/promises';

import { dirname, resolve, sep } from 'node:path';

import assert from 'node:assert/strict';

import { canonicalBuildPath } from './build-output.mjs';

export const markerName = '.heartwood-whole-build-owner';

export const identity = stat => ({
  dev: stat.dev,
  ino: stat.ino
});

export const same = (a, b) => a?.dev === b?.dev && a?.ino === b?.ino;

export const bound = async (label, work, ms) => {
  let timer;
  try {
    return await Promise.race([ Promise.resolve().then(work), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('stuck at ' + label + ' after ' + ms + 'ms')), ms);
    }) ]);
  } finally {
    clearTimeout(timer);
  }
};

export async function canonicalDirectory(dir) {
  const stat = await lstat(dir);
  assert(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(dir) === dir, 'Noncanonical build directory: ' + dir);
  return identity(stat);
}

export async function scratchParent(out) {
  let cursor = await canonicalBuildPath(out);
  for (let depth = 0; depth < 128; depth++) {
    try {
      await canonicalDirectory(cursor);
      return cursor;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const next = dirname(cursor);
    assert(next !== cursor, 'Missing output ancestor');
    cursor = next;
  }
  throw Error('Output ancestor depth exceeds128');
}

export async function readMarker(file) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    assert(before.isFile() && before.size > 0 && before.size <= 2048, 'Invalid whole-build owner marker');
    const bytes = Buffer.alloc(2049);
    let count = 0;
    while (count < bytes.length) {
      const result = await handle.read(bytes, count, bytes.length - count, null);
      if (!result.bytesRead) break;
      count += result.bytesRead;
    }
    const after = await handle.stat(), current = await lstat(file);
    assert(count === before.size && count <= 2048 && same(before, after) && same(before, current) && current.isFile() && !current.isSymbolicLink() && [ after, current ].every(stat => stat.size === before.size && stat.mtimeMs === before.mtimeMs && stat.ctimeMs === before.ctimeMs), 'Whole-build owner marker changed while reading');
    return JSON.parse(bytes.subarray(0, count).toString());
  } finally {
    await handle.close();
  }
}

export async function verifyScratch(record) {
  assert(record && record.schema === 1 && typeof record.token === 'string' && /^[0-9a-f-]{36}$/.test(record.token) && typeof record.path === 'string' && typeof record.parent === 'string' && record.path.startsWith(record.parent + sep + '.heartwood-whole-build-'), 'Malformed whole-build scratch record');
  assert(same(await canonicalDirectory(record.parent), record.parentIdentity), 'Build scratch parent changed');
  assert(same(await canonicalDirectory(record.path), record), 'Build scratch incarnation changed');
  assert.deepEqual(await readMarker(record.path + '/' + markerName), record, 'Build scratch marker changed');
  return record;
}

export async function cleanupScratch(record, {partial: partial = false} = {}) {
  if (!record) return;
  try {
    await lstat(record.path);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (partial) {
    assert(same(await canonicalDirectory(record.parent), record.parentIdentity) && same(await canonicalDirectory(record.path), record), 'Partial scratch changed');
  } else await verifyScratch(record);
  const names = [];
  let directory;
  try {
    directory = await opendir(record.path);
    for await (const entry of directory) {
      assert(names.length < 32, 'Scratch cleanup entry ceiling exceeded');
      assert(entry.isFile() && !entry.isSymbolicLink() && (entry.name === markerName || /^\.heartwood-build-[0-9a-f-]{36}\.tmp$/.test(entry.name)), 'Unknown whole-build scratch entry: ' + entry.name);
      names.push(entry.name);
    }
  } finally {
    if (directory) try {
      await directory.close();
    } catch (error) {
      if (error.code !== 'ERR_DIR_CLOSED') throw error;
    }
  }
  // An incomplete marker is eligible only during this guardian's failed setup,
  // before any Worker admission. Otherwise every deletion requires its exact marker.
    if (!partial) await verifyScratch(record); else assert(same(await canonicalDirectory(record.path), record), 'Partial scratch changed');
  for (const name of names) {
    const file = record.path + '/' + name, stat = await lstat(file);
    assert(stat.isFile() && !stat.isSymbolicLink(), 'Scratch entry changed');
    await unlink(file);
  }
  assert(same(await canonicalDirectory(record.path), record), 'Scratch changed before removal');
  await rmdir(record.path);
}
