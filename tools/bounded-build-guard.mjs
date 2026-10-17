// Standalone stdlib guardian. Only its own process can receive a fatal signal.
import { mkdtemp, lstat, realpath, open, opendir, unlink, rmdir } from 'node:fs/promises';

import { constants } from 'node:fs';

import { join, resolve, sep } from 'node:path';

import { pathToFileURL } from 'node:url';

import assert from 'node:assert/strict';

const markerName = '.hw-ordinary-build-owner', same = (a, b) => a?.dev === b?.dev && a?.ino === b?.ino;

const bound = async (label, work, ms) => {
  let timer;
  try {
    return await Promise.race([ Promise.resolve().then(work), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(Error('stuck at ' + label + ' after ' + ms + 'ms'), {
        exitCode: 124
      })), ms);
    }) ]);
  } finally {
    clearTimeout(timer);
  }
};

async function markerBytes(markerPath, {allowEmpty: allowEmpty = false, owner: owner} = {}) {
  const before = await lstat(markerPath);
  assert(before.isFile() && !before.isSymbolicLink() && Number.isSafeInteger(before.size) && before.size >= (allowEmpty ? 0 : 1) && before.size <= 4096, 'Build scratch marker is not bounded regular data');
  if (owner) assert(same(before, owner), 'Owned build scratch marker incarnation changed; preserved');
  const unchanged = stat => stat.isFile() && !stat.isSymbolicLink() && same(stat, before) && stat.size === before.size && stat.mtimeMs === before.mtimeMs && stat.ctimeMs === before.ctimeMs;
  const handle = await open(markerPath, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW || 0));
  try {
    assert(unchanged(await handle.stat()), 'Build scratch marker changed');
    const chunks = [];
    let size = 0;
    for (;;) {
      const bytes = Buffer.allocUnsafe(Math.min(4096, before.size - size + 1)), result = await handle.read(bytes, 0, bytes.length, null);
      if (!result.bytesRead) break;
      size += result.bytesRead;
      assert(size <= before.size, 'Build scratch marker changed');
      chunks.push(bytes.subarray(0, result.bytesRead));
    }
    assert(size === before.size && unchanged(await handle.stat()) && unchanged(await lstat(markerPath)), 'Build scratch marker changed');
    return Buffer.concat(chunks, size);
  } finally {
    await handle.close();
  }
}

export async function readScratchMarker(markerPath) {
  return JSON.parse((await markerBytes(markerPath)).toString('utf8'));
}

async function directoryIdentity(path) {
  const info = await lstat(path);
  assert(info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path, 'Owned build scratch directory changed; preserved');
  return info;
}

export async function cleanupBuildScratch(record, {partial: partial = false} = {}) {
  if (!record) return;
  assert(typeof record.path === 'string' && typeof record.parent === 'string' && record.path.startsWith(join(record.parent, '.heartwood-build-')) && typeof record.token === 'string' && /^[a-f0-9-]{36}$/.test(record.token), 'Malformed build scratch ownership');
  try {
    await lstat(record.path);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const verify = async () => {
    assert(same(await directoryIdentity(record.parent), record.parentOwner) && same(await directoryIdentity(record.path), record), 'Owned build scratch identity changed; preserved');
  };
  await verify();
  const entries = [];
  let directory;
  try {
    directory = await opendir(record.path);
    for await (const entry of directory) {
      assert(entries.length < 32, 'Build scratch cleanup entry ceiling exceeded');
      assert(entry.isFile() && !entry.isSymbolicLink() && (entry.name === markerName || !partial && /^\.heartwood-build-[a-f0-9-]{36}\.tmp$/.test(entry.name)), 'Unknown build scratch entry; preserved: ' + entry.name);
      const info = await lstat(join(record.path, entry.name));
      assert(info.isFile() && !info.isSymbolicLink(), 'Build scratch entry changed; preserved');
      entries.push({
        name: entry.name,
        info: info
      });
    }
  } finally {
    if (directory) try {
      await directory.close();
    } catch (error) {
      if (error.code !== 'ERR_DIR_CLOSED') throw error;
    }
  }
  const marker = entries.find(entry => entry.name === markerName);
  if (marker && record.markerOwner) assert(same(marker.info, record.markerOwner), 'Owned build scratch marker incarnation changed; preserved');
  if (partial) {
    assert(entries.length <= 1, 'Unknown pre-admission build scratch data; preserved');
    if (marker) {
      assert(record.markerOwner && same(marker.info, record.markerOwner), 'Owned build scratch marker incarnation changed; preserved');
      const bytes = await markerBytes(join(record.path, markerName), {
        allowEmpty: true,
        owner: record.markerOwner
      }), intended = Buffer.from(JSON.stringify({
        token: record.token
      }));
      assert(bytes.length <= intended.length && bytes.equals(intended.subarray(0, bytes.length)), 'Partial marker is not intended owned data; preserved');
    }
  } else {
    assert(marker, 'Completed build scratch marker changed/missing; preserved');
    assert.deepEqual(await readScratchMarker(join(record.path, markerName)), {
      token: record.token
    }, 'Owned build scratch marker changed; preserved');
  }
  await verify();
  for (const entry of entries) {
    const current = await lstat(join(record.path, entry.name));
    assert(current.isFile() && !current.isSymbolicLink() && same(current, entry.info) && current.size === entry.info.size && current.mtimeMs === entry.info.mtimeMs && current.ctimeMs === entry.info.ctimeMs, 'Build scratch entry changed; preserved');
  }
  // Never recurse into unknown data; every deletion is a pinned regular entry.
    for (const entry of entries) {
    await verify();
    const current = await lstat(join(record.path, entry.name));
    assert(current.isFile() && !current.isSymbolicLink() && same(current, entry.info) && current.size === entry.info.size && current.mtimeMs === entry.info.mtimeMs && current.ctimeMs === entry.info.ctimeMs, 'Build scratch entry changed; preserved');
    await unlink(join(record.path, entry.name));
  }
  await verify();
  await rmdir(record.path);
}

async function main() {
  assert(process.send, 'Ordinary build guardian requires dedicated parent IPC');
  let record, token, marked = false, started = false, closing, initialization, markerHandle, markerClosing, step = 'wait for parent admission', admissionTimer;
  const send = async message => {
    if (process.connected) await bound('guardian IPC delivery', () => new Promise((resolve, reject) => process.send(message, error => error ? reject(error) : resolve())), 250);
  };
  const closeMarker = () => markerClosing ??= markerHandle ? markerHandle.close() : Promise.resolve();
  const fatal = code => {
    process.exitCode = code;
    process.kill(process.pid, 'SIGKILL');
  };
  const cleanup = (code, message) => closing ??= (async () => {
    clearTimeout(admissionTimer);
    const hard = setTimeout(() => {
      console.error('[build guardian] shutdown exceeded8s at ' + step + '; cleanup FAILED');
      fatal(125);
    }, 8e3), errors = [];
    let ioStuck = false;
    if (initialization) try {
      await bound('guardian setup retirement', () => initialization.catch(() => {}), 750);
    } catch (error) {
      errors.push(error.message);
      ioStuck = true;
    }
    if (markerHandle) try {
      await bound('guardian marker descriptor close', closeMarker, 500);
    } catch (error) {
      errors.push(error.message);
      ioStuck = true;
    }
    try {
      await bound('owned guardian scratch cleanup', () => cleanupBuildScratch(record, {
        partial: !marked
      }), 1250);
    } catch (error) {
      errors.push(error.message);
      if (error.exitCode === 124) ioStuck = true;
    }
    if (errors.length) code = 125;
    const body = {
      type: 'closed',
      token: token,
      code: code,
      message: message,
      cleanup: {
        status: errors.length ? 'FAILED' : 'CLEAN',
        errors: errors
      }
    };
    try {
      await send(body);
    } catch (error) {
      errors.push(error.message);
      code = 125;
      if (error.exitCode === 124) ioStuck = true;
      console.error('[build guardian] IPC closure FAILED: ' + error.message);
    }
    if (process.connected) process.disconnect();
    clearTimeout(hard);
    process.exitCode = code;
    if (errors.length) console.error('[build guardian] ' + message + '; cleanup FAILED: ' + errors.join('; '));
    if (ioStuck) fatal(code);
  })();
  process.once('disconnect', () => void cleanup(143, 'parent disconnected at ' + step));
  for (const [signal, code] of [ [ 'SIGINT', 130 ], [ 'SIGTERM', 143 ], [ 'SIGHUP', 129 ] ]) process.once(signal, () => void cleanup(code, 'stopped by ' + signal + ' at ' + step));
  admissionTimer = setTimeout(() => void cleanup(124, 'guardian admission deadline exceeded'), 3e3);
  process.on('message', async message => {
    try {
      if (message?.type === 'close') {
        await cleanup(0, 'scratch closure requested');
        return;
      }
      assert(!started && !closing && message?.type === 'init' && typeof message.token === 'string' && /^[a-f0-9-]{36}$/.test(message.token) && typeof message.parent === 'string', 'Invalid build guardian initialization');
      started = true;
      token = message.token;
      clearTimeout(admissionTimer);
      initialization = (async () => {
        step = 'validate scratch parent';
        const parent = resolve(message.parent), parentOwner = await directoryIdentity(parent);
        if (closing) return;
        step = 'allocate scratch inode';
        const scratch = await mkdtemp(join(parent, '.heartwood-build-')), info = await lstat(scratch);
        assert(info.isDirectory() && !info.isSymbolicLink(), 'New build scratch incarnation changed');
        record = {
          path: scratch,
          parent: parent,
          parentOwner: {
            dev: parentOwner.dev,
            ino: parentOwner.ino
          },
          dev: info.dev,
          ino: info.ino,
          token: token
        };
        if (closing) return;
        step = 'create ownership marker';
        markerHandle = await open(join(scratch, markerName), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 384);
        const marker = await markerHandle.stat();
        assert(marker.isFile(), 'Build marker must be regular');
        record.markerOwner = {
          dev: marker.dev,
          ino: marker.ino
        };
        if (closing) return;
        step = 'write ownership marker';
        try {
          await markerHandle.writeFile(JSON.stringify({
            token: token
          }));
        } finally {
          await closeMarker();
        }
        marked = true;
      })();
      await bound('guardian scratch initialization', () => initialization, 3e3);
      if (closing) return;
      step = 'owned scratch admitted';
      await send({
        type: 'ready',
        path: record.path,
        dev: record.dev,
        ino: record.ino,
        token: token,
        record: record
      });
    } catch (error) {
      try {
        await send({
          type: 'error',
          message: error.message,
          code: error.exitCode || 1,
          token: token
        });
      } catch {}
      await cleanup(error.exitCode || 1, error.message);
    }
  });
}

if (import.meta.main ?? (process.argv[1] && import.meta.url === pathToFileURL(await realpath(resolve(process.argv[1]))).href)) await main();
