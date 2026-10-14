import { lstat, mkdir, open, rename, rm, realpath } from 'node:fs/promises';

import { constants, unlinkSync, lstatSync } from 'node:fs';

import { resolve, join, dirname, basename, parse, sep } from 'node:path';

import { randomUUID } from 'node:crypto';

import { setTimeout as delay } from 'node:timers/promises';

const maybeStat = async path => {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

const identity = stat => stat && [ stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs ].join(':');

const within = (path, root) => path === root || path.startsWith(root + sep);

const activeTemporary = new Map;

const removeOwnTemporary = path => {
  const owned = activeTemporary.get(path);
  if (!owned) return;
  try {
    const stat = lstatSync(path);
    if (stat.isFile() && !stat.isSymbolicLink() && stat.dev === owned.dev && stat.ino === owned.ino) unlinkSync(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  } finally {
    activeTemporary.delete(path);
  }
};

process.once('exit', () => {
  for (const path of activeTemporary.keys()) try {
    removeOwnTemporary(path);
  } catch {}
});

// Normalize a caller-selected directory spelling once. Missing output descendants
// retain their names; the existing ancestor comes from the filesystem's realpath.
// Internal ownership records and generated descendants still use strict identities.
export async function canonicalBuildPath(path) {
  const missing = [];
  let cursor = resolve(path);
  for (let depth = 0; depth < 128; depth++) {
    try {
      const canonical = await realpath(cursor), stat = await lstat(canonical);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Build ancestor is not a directory: ' + cursor);
      return join(canonical, ...missing.reverse());
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(cursor);
    if (parent === cursor) throw Error('Missing output ancestor');
    missing.push(basename(cursor));
    cursor = parent;
  }
  throw Error('Build ancestor depth exceeds128');
}

export function isOperatingSystemMetadata(name) {
  return name === '.DS_Store' || /^(?:Thumbs\.db|desktop\.ini)$/i.test(name);
}

// Windows readers may temporarily deny replacement. Retry only those failures,
// briefly, and admit the same source, target and parent incarnation each time.
export async function replaceOutputFile(temporary, target, {platform: platform = process.platform, attempts: attempts = 6, retryDelayMs: retryDelayMs = 25, renameFile: renameFile = rename, signal: signal, expected: expected} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 8 || !Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 100 || typeof renameFile !== 'function') throw Error('Invalid output replacement retry options');
  const parent = dirname(target), temporaryParent = dirname(temporary);
  const pinned = expected || {
    parent: await lstat(parent),
    temporaryParent: await lstat(temporaryParent),
    temporary: await lstat(temporary),
    target: await maybeStat(target)
  };
  const verify = async () => {
    if (signal?.aborted) throw signal.reason || Error('Output replacement cancelled');
    await ensureOutputDirectory(parent, {
      create: false
    });
    await ensureOutputDirectory(temporaryParent, {
      create: false
    });
    const currentParent = await lstat(parent), currentTemporaryParent = await lstat(temporaryParent);
    const currentTemporary = await lstat(temporary), currentTarget = await maybeStat(target);
    if (currentParent.dev !== pinned.parent.dev || currentParent.ino !== pinned.parent.ino || currentTemporaryParent.dev !== pinned.temporaryParent.dev || currentTemporaryParent.ino !== pinned.temporaryParent.ino || !currentTemporary.isFile() || currentTemporary.isSymbolicLink() || identity(currentTemporary) !== identity(pinned.temporary) || currentTarget && (!currentTarget.isFile() || currentTarget.isSymbolicLink()) || identity(currentTarget) !== identity(pinned.target)) {
      throw Error('Output changed during build: ' + target);
    }
    if (signal?.aborted) throw signal.reason || Error('Output replacement cancelled');
  };
  for (let attempt = 0; attempt < attempts; attempt++) {
    await verify();
    try {
      await renameFile(temporary, target);
      return;
    } catch (error) {
      if (platform !== 'win32' || ![ 'EPERM', 'EACCES', 'EBUSY' ].includes(error.code) || attempt === attempts - 1) throw error;
      await delay(retryDelayMs * (attempt + 1), undefined, {
        signal: signal
      });
    }
  }
}

// An output directory is a real directory at every level. Symlink aliases are rejected,
// including aliases to source; callers may use the canonical path explicitly instead.
export async function ensureOutputDirectory(out, {root: root, protectedPaths: protectedPaths = [], create: create = true} = {}) {
  const absolute = resolve(out), canonicalRoot = root ? await realpath(root) : null;
  const forbidden = await Promise.all(protectedPaths.map(path => canonicalBuildPath(path)));
  const proposed = await canonicalBuildPath(absolute);
  if (canonicalRoot && proposed === canonicalRoot || forbidden.some(path => within(proposed, path))) {
    throw Error('Output resolves to protected input: ' + proposed);
  }
  if (canonicalRoot && absolute === canonicalRoot || forbidden.some(path => within(absolute, path))) throw Error('Output would overwrite protected input: ' + absolute);
  const volume = parse(absolute).root, parts = absolute.slice(volume.length).split(sep).filter(Boolean);
  let cursor = volume;
  for (const part of parts) {
    cursor = join(cursor, part);
    let stat = await maybeStat(cursor);
    if (!stat) {
      if (!create) throw Error('Output directory changed or disappeared: ' + cursor);
      await mkdir(cursor);
      stat = await lstat(cursor);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('Output directory is not a real directory: ' + cursor);
  }
  const canonical = await realpath(absolute);
  if (canonicalRoot && canonical === canonicalRoot || forbidden.some(path => within(canonical, path))) throw Error('Output resolves to protected input: ' + canonical);
  return canonical;
}

export async function writeOutput(out, relative, bytes, {temporaryRoot: temporaryRoot, signal: signal} = {}) {
  if (signal?.aborted) throw signal.reason || Error('Output write cancelled');
  out = await canonicalBuildPath(out);
  const target = resolve(out, relative);
  if (!within(target, resolve(out)) || target === resolve(out)) throw Error('Output path escaped its directory');
  const parent = dirname(target);
  await ensureOutputDirectory(parent);
  const parentBefore = await lstat(parent), before = await maybeStat(target);
  if (before && (!before.isFile() || before.isSymbolicLink())) throw Error('Output target is not a regular file: ' + target);
  const temporaryParent = temporaryRoot ? await ensureOutputDirectory(temporaryRoot) : parent;
  if (temporaryRoot && (await lstat(temporaryParent)).dev !== parentBefore.dev) throw Error('Build scratch is on a different filesystem');
  const temporary = join(temporaryParent, '.heartwood-build-' + randomUUID() + '.tmp');
  let handle;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 420);
    const owned = lstatSync(temporary);
    activeTemporary.set(temporary, {
      dev: owned.dev,
      ino: owned.ino
    });
    await handle.writeFile(bytes);
    await handle.close();
    handle = null;
    if (signal?.aborted) throw signal.reason || Error('Output write cancelled');
    await ensureOutputDirectory(parent);
    const parentAfter = await lstat(parent), after = await maybeStat(target);
    if (parentBefore.dev !== parentAfter.dev || parentBefore.ino !== parentAfter.ino || identity(before) !== identity(after)) throw Error('Output changed during build: ' + target);
    if (signal?.aborted) throw signal.reason || Error('Output write cancelled');
    await replaceOutputFile(temporary, target, {
      signal: signal,
      expected: {
        parent: parentBefore,
        target: before,
        temporary: await lstat(temporary),
        temporaryParent: await lstat(temporaryParent)
      }
    });
  } finally {
    await (handle?.close());
    removeOwnTemporary(temporary);
  }
}

// Cleanup is restricted both by the previous manifest and these exact generated names.
export function ownedFingerprint(relative) {
  return /^(?:(?:css\/heartwood-(?:site|taste)\.[0-9a-f]{12}\.css|js\/heartwood-(?:site|taste|taste-head)\.[0-9a-f]{12}\.js)|assets\/logos\/heartwood-logos\.[0-9a-f]{12}\.svg|assets\/grain\/grain-fine-\d+@[\d.]+x\.[0-9a-f]{12}\.webp|assets\/meta\/[a-z0-9-]+\.[0-9a-f]{12}\.(?:svg|png|jpg)|assets\/photos\/[a-z0-9-]+-\d+\.[0-9a-f]{12}\.webp|mobile\/assets\/[a-zA-Z0-9@.-]+\.[0-9a-f]{16}\.(?:avif|webp|woff2|svg|png|css|js|txt))$/.test(relative);
}

export async function removeRecordedFingerprint(out, relative) {
  if (!ownedFingerprint(relative)) return false;
  const target = resolve(out, relative);
  if (!within(target, resolve(out))) throw Error('Cleanup escaped output');
  if (!await maybeStat(dirname(target))) return true;
  await ensureOutputDirectory(dirname(target));
  for (const suffix of [ '', '.gz', '.br' ]) {
    const path = target + suffix, stat = await maybeStat(path);
    if (!stat) continue;
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Cleanup target is not a regular file: ' + path);
    await rm(path);
  }
  return true;
}
