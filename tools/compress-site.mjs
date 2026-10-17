import { constants } from 'node:fs';

import { open, realpath, lstat } from 'node:fs/promises';

import { resolve, join, extname, sep } from 'node:path';

import { fileURLToPath } from 'node:url';

import { gzipSync, gunzipSync, brotliCompressSync, brotliDecompressSync, constants as z } from 'node:zlib';

import assert from 'node:assert/strict';

import { writeOutput, canonicalBuildPath } from './build-output.mjs';

import { isBuildMain, runBuildCommand } from './build-cli.mjs';

export function encodePublicText(raw) {
  assert(raw instanceof Uint8Array && raw.length <= 16 * 1024 * 1024, 'Compression input must be at most16MiB');
  const gzip = gzipSync(raw, {
    level: 9
  });
  gzip[9] = 255;
  const brotli = brotliCompressSync(raw, {
    params: {
      [z.BROTLI_PARAM_MODE]: z.BROTLI_MODE_GENERIC,
      [z.BROTLI_PARAM_QUALITY]: 11,
      [z.BROTLI_PARAM_LGWIN]: 22
    }
  });
  assert.deepEqual(gunzipSync(gzip), Buffer.from(raw), 'Gzip round-trip failed');
  assert.deepEqual(brotliDecompressSync(brotli), Buffer.from(raw), 'Brotli round-trip failed');
  return {
    gzip: gzip,
    brotli: brotli
  };
}

export async function readCompressionInput(file, maxBytes = 16 * 1024 * 1024, {root: root} = {}) {
  assert(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 16 * 1024 * 1024, 'Compression byte ceiling must be1..16MiB');
  const selected = resolve(file), selectedBefore = await lstat(selected);
  assert(selectedBefore.isFile() && !selectedBefore.isSymbolicLink(), 'Compression input must be a regular file');
  file = await realpath(selected);
  if (root) {
    const canonicalRoot = await realpath(root);
    assert(file.startsWith(canonicalRoot + sep), 'Compression input escaped selected output');
  }
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const before = await handle.stat();
    assert(before.isFile() && Number.isSafeInteger(before.size) && before.size >= 0 && before.size <= maxBytes, 'Invalid compression input');
    assert(before.dev === selectedBefore.dev && before.ino === selectedBefore.ino, 'Compression input changed during canonicalization');
    const chunks = [];
    let size = 0;
    for (;;) {
      const bytes = Buffer.allocUnsafe(Math.min(65536, maxBytes - size + 1));
      const result = await handle.read(bytes, 0, bytes.length, null);
      if (!result.bytesRead) break;
      size += result.bytesRead;
      assert(size <= maxBytes, 'Compression input grew beyond ceiling');
      chunks.push(bytes.subarray(0, result.bytesRead));
    }
    const after = await handle.stat(), current = await lstat(file), selectedAfter = await lstat(selected);
    assert(size === before.size && current.isFile() && !current.isSymbolicLink() && selectedAfter.isFile() && !selectedAfter.isSymbolicLink() && [ after, current, selectedAfter ].every(stat => stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size && stat.mtimeMs === before.mtimeMs && stat.ctimeMs === before.ctimeMs), 'Compression source changed');
    return Buffer.concat(chunks, size);
  } finally {
    await handle.close();
  }
}

export async function compressBuild({root: root, publish: publish = join(root, 'publish'), manifest: manifest, writer: writer = writeOutput, onStep: onStep = () => {}}) {
  root = await realpath(resolve(root));
  publish = await canonicalBuildPath(publish);
  assert(typeof writer === 'function', 'Compression requires an output writer');
  if (!manifest) {
    manifest = JSON.parse((await readCompressionInput(join(root, 'tools/build-manifest.json'), 1024 * 1024, {
      root: root
    })).toString());
  }
  assert(Array.isArray(manifest.generated) && manifest.generated.length > 0 && manifest.generated.length <= 4096 && new Set(manifest.generated).size === manifest.generated.length, 'Compression manifest must have1..4096 unique generated paths');
  const sizes = Object.create(null);
  let total = 0;
  onStep('compress public text assets');
  for (const relative of manifest.generated) {
    assert(typeof relative === 'string' && relative && !relative.includes('\\') && !relative.includes('\0'), 'Invalid generated path');
    const target = resolve(publish, relative);
    assert(target.startsWith(publish + sep), 'Compression output escaped publish');
    if (![ '.html', '.css', '.js', '.svg' ].includes(extname(target))) continue;
    const raw = await readCompressionInput(target, 16 * 1024 * 1024, {
      root: publish
    });
    total += raw.length;
    assert(total <= 64 * 1024 * 1024, 'Compression corpus exceeds64MiB');
    const encoded = encodePublicText(raw);
    await writer(publish, relative + '.gz', encoded.gzip);
    await writer(publish, relative + '.br', encoded.brotli);
    sizes[relative] = {
      raw: raw.length,
      gzip: encoded.gzip.length,
      brotli: encoded.brotli.length
    };
  }
  assert(Object.keys(sizes).length > 0, 'Compression manifest contained no text assets');
  await writer(join(root, 'tools'), 'compression-report.json', JSON.stringify(sizes, null, 2) + '\n');
  console.log(JSON.stringify(sizes, null, 2));
  return sizes;
}

if (await isBuildMain(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && [ '--help', '-h' ].includes(args[0])) {
      console.log('Usage: node tools/compress-site.mjs\nCompress the current recorded public text outputs.');
    } else {
      if (args.length) throw Error('Unknown compression option: ' + args[0]);
      const root = await realpath(fileURLToPath(new URL('..', import.meta.url)));
      await runBuildCommand('compression', ({ writer, onStep }) => compressBuild({ root, writer, onStep }));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = error.exitCode || 1;
  }
}
