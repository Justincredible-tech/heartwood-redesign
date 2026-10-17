import assert from 'node:assert/strict';

import { writeFile, readFile, lstat } from 'node:fs/promises';

import { join } from 'node:path';

import { randomUUID } from 'node:crypto';

import { runOwnedArtJob } from '../../tools/mobile-art-runtime.mjs';

const [out, mode = 'complete'] = process.argv.slice(2);

const result = await runOwnedArtJob({
  timeoutMs: 3e4,
  shutdownMs: 8e3,
  output: out,
  browserExecutable: process.execPath,
  sharpModule: process.env.HW_ART_SHARP_MODULE,
  playwrightModule: process.env.HW_ART_PLAYWRIGHT_MODULE
}, async runtime => {
  const ownership = await runtime.ensureOutputDirectory(out, {
    reason: 'focused local pinned encoder/toolchain proof'
  });
  assert.equal(ownership.path, out);
  assert.equal(typeof ownership.resourceId, 'string');
  const sharp = await runtime.loadSharp(), bytes = await runtime.deadline('encode exact tiny proof image', () => sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: {
        r: 1,
        g: 2,
        b: 3,
        alpha: 1
      }
    }
  }).png().toBuffer(), {
    timeoutMs: 1e4
  });
  assert(bytes.length > 0);
  await writeFile(join(out, 'proof.png'), bytes);
  const receipt = runtime.toolchainReceipt(), packages = receipt.packages;
  for (const name of [ 'sharp', 'playwright-core', '@img/colour', 'detect-libc', 'semver', '@img/sharp-' + receipt.native.platform + '-' + receipt.native.arch, '@img/sharp-libvips-' + receipt.native.platform + '-' + receipt.native.arch ]) assert(packages.some(p => p.name === name), 'Missing actual dependency/native closure ' + name);
  assert.equal(receipt.encoder.version, sharp.versions.sharp);
  assert.equal(receipt.browser.status, 'NOT_LOADED');
  const json = JSON.stringify(receipt);
  const hostProfile='Users',homeSegment='home';   // host profile segment names assembled at runtime so this public source keeps no host path literal
  const hostShapes=[new RegExp('/'+hostProfile+'/[^"\\s]+'),new RegExp('/'+homeSegment+'/[^"\\s]+'),new RegExp('[A-Za-z]:\\\\'+hostProfile+'\\\\'),new RegExp('file:///(?:'+hostProfile+'|'+homeSegment+')/')];
  assert(!hostShapes.some(pattern=>pattern.test(json)) && !json.includes('.audit/') && !json.includes(process.env.HW_TOOL_RUN_TOKEN), 'Public receipt must omit host-private path shapes (macOS/Linux/Windows/home and file URLs) and private/run identifiers');
  const marker = JSON.parse(await readFile(join(out, '.hw-tool-owner'), 'utf8'));
  await runtime.preserveOutput(out, 'complete explicit local encoder proof, not art acceptance');
  assert.deepEqual(JSON.parse(await readFile(join(out, '.hw-tool-owner'), 'utf8')), marker, 'Retention must preserve the same authenticated owner marker');
  if (mode === 'fail-after-retain') throw Error('exact deliberate failure after retention');
  if (mode === 'guard-fail-after-retain') {
    const resourceId = randomUUID();
    await writeFile(join(process.env.HW_TOOL_RUN_DIR, 'resources', resourceId + '.json'), JSON.stringify({
      kind: 'unsupported-art-proof',
      preexisting: false,
      resourceId: resourceId,
      token: process.env.HW_TOOL_RUN_TOKEN
    }));
  }
  if (mode === 'death-after-retain') {
    const meta = JSON.parse(await readFile(join(process.env.HW_TOOL_RUN_DIR, 'run.json'), 'utf8'));
    console.log('@@artRetention ' + JSON.stringify({
      token: meta.token,
      worker: meta.worker,
      helper: meta.helper,
      runDir: process.env.HW_TOOL_RUN_DIR,
      scratch: process.env.TMPDIR
    }));
    await new Promise(resolve => setTimeout(resolve, 6e4));
  }
  return {
    packageNames: packages.map(p => p.name),
    encoder: receipt.encoder.version,
    encodedBytes: bytes.length,
    browser: 'NOT_LOADED',
    receipt: receipt,
    ownership: {
      dev: ownership.dev,
      ino: ownership.ino
    },
    markerResourcePreserved: true
  };
});

assert((await lstat(out)).isDirectory());

console.log('@@artToolchain ' + JSON.stringify(result));
