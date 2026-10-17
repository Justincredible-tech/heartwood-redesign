// Complete composition-input receipt. Inert import; stdlib only, no browser/encoder/download.
import { lstat, realpath, open } from 'node:fs/promises';

import { resolve, relative, sep } from 'node:path';

import { createHash } from 'node:crypto';

import { constants } from 'node:fs';

import { imageDimensions, readBuildInput } from './build-mobile-inputs.mjs';

export const PHONE_COMPOSERS = [ 'tools/build-mobile.mjs', 'source/build-features.mjs', 'tools/feature-output.mjs', 'tools/mobile-feature-source.mjs', 'tools/supervised-build-options.mjs', 'tools/mobile-origin.mjs', 'tools/mobile-art-encoding.mjs', 'tools/mobile-theme.mjs', 'tools/build-mobile-inputs.mjs', 'tools/mobile-source-inputs.mjs', 'tools/build-output.mjs', 'tools/grain-inputs.mjs', 'tools/build-cli.mjs', 'source/mobile/content.mjs', 'source/mobile/art.mjs', 'source/mobile/night.mjs', 'source/mobile/page.mjs', 'source/mobile/state.mjs', 'source/mobile/app.js', 'source/js/live-photos.js', 'source/mobile/mobile.css', 'source/taste/taste-dark.mjs' ];

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const identity = s => [ s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs ].join(':');

const safe = path => typeof path === 'string' && path.length > 0 && path.length < 1024 && /^[A-Za-z0-9@._/-]+$/.test(path) && path.split('/').every(p => p && p !== '.' && p !== '..');

export function originDigest(rows) {
  return sha256(rows.map(row => row.origin + ':' + row.path + ':' + row.role + ':' + row.bytes + ':' + row.sha256).sort().join('\n'));
}

export async function withDeadline(label, work, timeoutMs = 1e4) {
  let timer;
  try {
    return await Promise.race([ Promise.resolve().then(work), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('stuck at ' + label + ' after ' + timeoutMs + 'ms')), timeoutMs);
    }) ]);
  } finally {
    clearTimeout(timer);
  }
}

const role = path => path.includes('/art/masters/') ? 'master' : path.includes('/art/encoded/') ? 'encoded' : /\.(jpg|jpeg)$/.test(path) ? 'photo-source' : /\.(woff2|txt)$/.test(path) ? 'font-or-license' : path.includes('/assets/meta/') ? 'meta' : path.endsWith('reference-paper.css') ? 'paper-reference' : path.startsWith('tools/') ? 'composer' : /\.(mjs|js)$/.test(path) ? 'behavior-or-layout' : path.endsWith('.css') ? 'style' : 'content';

export async function createBuildOrigin({root: root, sourceRoot: sourceRoot = root, readInput: readInput = readBuildInput} = {}) {
  const roots = {
    project: await realpath(resolve(root)),
    content: await realpath(resolve(sourceRoot))
  }, cache = new Map, directories = new Map;
  let total = 0;
  const stats = {
    bodyReads: 0,
    metadataStreams: 0,
    cacheHits: 0,
    bytesRead: 0,
    retainedBodyBytes: 0,
    maxRetainedBodyBytes: 0,
    maxHeaderAccumulatorBytes: 0,
    scope: 'Verified-reader body cache/header accumulator only; excludes caller-held buffers, parsed strings/VM objects, native/OS buffers and RSS.'
  };
  for (const base of new Set(Object.values(roots))) {
    const s = await withDeadline('validate source root', () => lstat(base));
    if (!s.isDirectory() || s.isSymbolicLink() || await withDeadline('canonical source root', () => realpath(base)) !== base) throw Error('Build origin requires canonical real source roots');
    directories.set(base, {
      dev: s.dev,
      ino: s.ino
    });
  }
  async function prepare(file) {
    const absolute = resolve(file), origin = absolute === roots.project || absolute.startsWith(roots.project + sep) ? 'project' : absolute.startsWith(roots.content + sep) ? 'content' : null;
    if (!origin) throw Error('Composition input escaped declared roots: ' + absolute);
    const path = relative(roots[origin], absolute).split(sep).join('/');
    if (!safe(path)) throw Error('Unsafe composition input path: ' + path);
    if (!cache.has(absolute) && cache.size >= 2048) throw Error('Composition exceeds2048input bound');
    const parts = path.split('/');
    let cursor = roots[origin];
    for (const p of parts.slice(0, -1)) {
      cursor = resolve(cursor, p);
      if (directories.has(cursor)) continue;
      const s = await withDeadline('validate source ancestor ' + path, () => lstat(cursor));
      if (s.isSymbolicLink() || !s.isDirectory()) throw Error('Expected real source directories: ' + path);
      directories.set(cursor, {
        dev: s.dev,
        ino: s.ino
      });
    }
    const before = await withDeadline('stat input ' + path, () => lstat(absolute));
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > 8 * 1024 * 1024) throw Error('Composition input exceeds bounded regular range: ' + path);
    const known = cache.get(absolute);
    if (known && identity(before) !== known.identity) throw Error('Composition input epoch changed: ' + path);
    return {
      absolute: absolute,
      origin: origin,
      path: path,
      before: before,
      known: known
    };
  }
  async function capture(info, {digest: digest, data: data, dimensions: dimensions}) {
    const after = await withDeadline('restat input ' + info.path, () => lstat(info.absolute));
    if (!after.isFile() || after.isSymbolicLink() || identity(info.before) !== identity(after)) throw Error('Composition input changed while reading: ' + info.path);
    if (info.known && (digest !== info.known.row.sha256 || info.before.size !== info.known.row.bytes)) throw Error('Composition input bytes changed: ' + info.path);
    if (!info.known) {
      total += info.before.size;
      if (total > 64 * 1024 * 1024) throw Error('Composition exceeds64MiB input bound');
    }
    const row = Object.freeze({
      path: info.path,
      origin: info.origin,
      role: role(info.path),
      bytes: info.before.size,
      sha256: digest
    }), item = {
      row: row,
      identity: identity(after),
      data: data,
      dimensions: dimensions || info.known?.dimensions
    };
    cache.set(info.absolute, item);
    if (data) {
      stats.retainedBodyBytes += data.length;
      stats.maxRetainedBodyBytes = Math.max(stats.maxRetainedBodyBytes, stats.retainedBodyBytes);
    }
    return item;
  }
  async function read(file) {
    const absolute = resolve(file), known = cache.get(absolute);
    if (known?.data) {
      stats.cacheHits++;
      return known.data;
    }
    const info = await prepare(file), value = await withDeadline('read input ' + info.path, () => readInput(info.absolute)), data = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (data.length !== info.before.size) throw Error('Composition input size changed: ' + info.path);
    stats.bodyReads++;
    stats.bytesRead += data.length;
    await capture(info, {
      digest: sha256(data),
      data: data
    });
    return data;
  }
  async function inspect(file, type) {
    if (![ 'png', 'jpeg' ].includes(type)) throw Error('Unsupported metadata-only image type');
    const absolute = resolve(file), known = cache.get(absolute);
    if (known?.dimensions) {
      stats.cacheHits++;
      return {
        row: known.row,
        dimensions: known.dimensions
      };
    }
    if (known?.data) {
      known.dimensions = imageDimensions(known.data, type);
      return {
        row: known.row,
        dimensions: known.dimensions
      };
    }
    const info = await prepare(file), hash = createHash('sha256'), chunk = Buffer.alloc(65536);
    let handle, position = 0, header = Buffer.alloc(0), dimensions;
    try {
      handle = await withDeadline('open image input ' + info.path, () => open(info.absolute, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW));
      const opened = await withDeadline('verify opened image input ' + info.path, () => handle.stat());
      if (!opened.isFile() || identity(opened) !== identity(info.before)) throw Error('Opened image identity changed: ' + info.path);
      while (position < info.before.size) {
        const {bytesRead: bytesRead} = await withDeadline('stream image digest ' + info.path, () => handle.read(chunk, 0, Math.min(chunk.length, info.before.size - position), position));
        if (!bytesRead) throw Error('Short image digest read: ' + info.path);
        hash.update(chunk.subarray(0, bytesRead));
        position += bytesRead;
        stats.bytesRead += bytesRead;
        if (!dimensions) {
          header = Buffer.concat([ header, chunk.subarray(0, type === 'png' ? Math.min(bytesRead, 24 - header.length) : bytesRead) ]);
          stats.maxHeaderAccumulatorBytes = Math.max(stats.maxHeaderAccumulatorBytes, header.length);
          try {
            dimensions = imageDimensions(header, type);
            header = Buffer.alloc(0);
          } catch (error) {
            if (type === 'png' || !error.message.includes('no supported dimension frame') && !error.message.includes('no supported dimension') && !error.message.includes('no supported frame')) throw error;
          }
        }
      }
      if (!dimensions) throw Error('Image has no bounded supported header: ' + info.path);
      const finished = await withDeadline('verify image descriptor epoch ' + info.path, () => handle.stat());
      if (identity(finished) !== identity(info.before)) throw Error('Image descriptor epoch changed: ' + info.path);
      stats.metadataStreams++;
      const item = await capture(info, {
        digest: hash.digest('hex'),
        dimensions: dimensions
      });
      return {
        row: item.row,
        dimensions: dimensions
      };
    } finally {
      if (handle) await withDeadline('close image descriptor ' + info.path, () => handle.close());
    }
  }
  function release(file) {
    const item = cache.get(resolve(file));
    if (item?.data) {
      stats.retainedBodyBytes -= item.data.length;
      item.data = undefined;
    }
  }
  async function verify() {
    for (const [directory, before] of directories) {
      const now = await withDeadline('verify source ancestor', () => lstat(directory));
      if (!now.isDirectory() || now.isSymbolicLink() || now.dev !== before.dev || now.ino !== before.ino) throw Error('Composition source directory identity changed: ' + directory);
    }
    for (const [file, item] of cache) {
      const now = await withDeadline('verify input epoch ' + item.row.path, () => lstat(file));
      if (!now.isFile() || now.isSymbolicLink() || identity(now) !== item.identity) throw Error('Composition input epoch changed: ' + item.row.path);
    }
  }
  return {
    read: read,
    inspect: inspect,
    release: release,
    async captureComposers() {
      for (const path of PHONE_COMPOSERS) await read(resolve(roots.project, path));
    },
    async finish({art: art, photos: photos} = {}) {
      await verify();
      const inputs = [ ...cache.values() ].map(item => item.row).sort((a, b) => {
        const x = a.origin + ':' + a.path, y = b.origin + ':' + b.path;
        return x < y ? -1 : x > y ? 1 : 0;
      });
      return {
        schema: 1,
        kind: 'public-phone-composition',
        inputDigest: originDigest(inputs),
        inputs: inputs,
        art: art,
        photos: photos,
        composition: {
          sourceEpochUnchanged: true,
          assets: 'retained-reviewed-bytes',
          browserLaunched: false,
          encoderLoaded: false,
          inputReadStats: {
            ...stats
          }
        },
        toolchain: {
          node: {
            version: process.version,
            versions: process.versions,
            platform: process.platform,
            arch: process.arch
          },
          assetRenderer: {
            status: 'RETAINED_PINNED_ORIGIN_UNPROVED'
          },
          assetEncoder: {
            status: 'RETAINED_PINNED_ORIGIN_UNPROVED'
          }
        },
        limitations: [ 'Composer/asset bytes and file epochs are bound for this composition; existing master/encoded files do not establish their historical renderer/encoder toolchain.', 'Node reports its versions; executable/builtin binary hashes, complete OS/toolchain identity and pre-entry parsed module cache provenance are not certified.' ]
      };
    },
    get rows() {
      return [ ...cache.values() ].map(item => item.row);
    },
    get stats() {
      return {
        ...stats
      };
    },
    verify: verify
  };
}
