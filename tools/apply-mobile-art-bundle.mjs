// Explicit guarded application of a complete public phone-art bundle. No browser/encoder/network.
// The public supervisor must recover this typed directory transaction after worker/launcher death.
import { lstat, readdir, mkdir, realpath } from 'node:fs/promises';

import { resolve, join, relative, sep } from 'node:path';

import { randomUUID } from 'node:crypto';

import { parseArgs } from 'node:util';

import { pathToFileURL } from 'node:url';

import assert from 'node:assert/strict';

import { createBuildOrigin, PHONE_COMPOSERS, sha256, withDeadline } from './mobile-origin.mjs';

import { readBuildInput, imageDimensions } from './build-mobile-inputs.mjs';

import { writeOutput } from './build-output.mjs';

import { loadMobileSources } from './mobile-source-inputs.mjs';

import { encodeFor } from './mobile-art-encoding.mjs';

import { permissionMode, permissionDigest, assertSupportedArtPermissions, applyArtPermissions, validateNativeArtOrigins } from './mobile-art-integrity.mjs';

import { requireCoLocatedArtProject } from './mobile-art-project.mjs';

const defaultRoot = resolve(import.meta.dirname, '..'), safe = path => typeof path === 'string' && path.length > 0 && path.length < 1024 && !/[\\\x00-\x1f\x7f]/.test(path) && !path.startsWith('/') && !/^[A-Za-z]:/.test(path) && path.split('/').every(p => p && p !== '.' && p !== '..');

export const treeDigest = rows => sha256(rows.map(row => row.path + ':' + row.sha256).sort().join('\n'));

const directoryIdentity = info => ({
  dev: info.dev,
  ino: info.ino
});

export async function artTreeSnapshot(directory, {ownership: ownership} = {}) {
  const base = await withDeadline('canonical caller art directory', () => realpath(resolve(directory))), first = await withDeadline('validate art directory', () => lstat(base));
  assert(first.isDirectory() && !first.isSymbolicLink() && await withDeadline('canonical art directory', () => realpath(base)) === base, 'Expected canonical real art directory');
  const rows = [], directories = [], directoryModes = [], identities = new Map([ [ base, first ] ]);
  let total = 0, entryCount = 0;
  async function walk(folder, depth) {
    assert(depth <= 4, 'Art tree exceeds depth bound');
    const entries = await withDeadline('list art tree', () => readdir(folder, {
      withFileTypes: true
    }));
    assert(entries.length <= 2048, 'Art tree exceeds directory entry bound');
    for (const entry of entries) {
      assert(++entryCount <= 4096, 'Art tree exceeds4096entries');
      const file = join(folder, entry.name), path = relative(base, file).split(sep).join('/');
      assert(safe(path), 'Unsafe art-tree path');
      const before = await withDeadline('stat art-tree entry ' + path, () => lstat(file));
      assert(!before.isSymbolicLink(), 'Art tree contains a symlink');
      identities.set(file, before);
      if (before.isDirectory()) {
        directories.push(path);
        directoryModes.push({
          path: path,
          mode: permissionMode(before.mode),
          dev: before.dev,
          ino: before.ino
        });
        await walk(file, depth + 1);
        continue;
      }
      assert(before.isFile() && before.size >= 0 && before.size <= 8 * 1024 * 1024, 'Art tree contains nonregular/unbounded file');
      assert(rows.length < 2048, 'Art tree exceeds2048files');
      const bytes = await withDeadline('hash art-tree entry ' + path, () => readBuildInput(file)), after = await withDeadline('recheck art-tree entry ' + path, () => lstat(file));
      assert(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && bytes.length === before.size, 'Art-tree input changed');
      if (path === '.hw-tool-owner' && ownership) {
        assert(ownership.path === base && ownership.dev === first.dev && ownership.ino === first.ino, 'Stage ownership incarnation changed');
        const marker = JSON.parse(bytes);
        assert(marker.token === ownership.token && marker.resourceId === ownership.resourceId, 'Stage ownership marker changed');
        continue;
      }
      total += bytes.length;
      assert(total <= 64 * 1024 * 1024, 'Art tree exceeds64MiB');
      rows.push({
        path: path,
        bytes: bytes.length,
        sha256: sha256(bytes),
        mode: permissionMode(before.mode),
        dev: before.dev,
        ino: before.ino
      });
    }
  }
  await walk(base, 0);
  assert(rows.length > 0, 'Art tree is empty');
  for (const [file, before] of identities) {
    const now = await withDeadline('verify tree input epoch', () => lstat(file));
    assert(!now.isSymbolicLink() && now.dev === before.dev && now.ino === before.ino && permissionMode(now.mode) === permissionMode(before.mode) && (before.isDirectory() ? now.isDirectory() : now.isFile() && now.size === before.size && now.mtimeMs === before.mtimeMs && now.ctimeMs === before.ctimeMs), 'Art-tree input epoch changed');
  }
  rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  directories.sort();
  directoryModes.sort((a, b) => a.path.localeCompare(b.path));
  const record = {
    path: base,
    ...directoryIdentity(first),
    rootMode: permissionMode(first.mode),
    digest: treeDigest(rows),
    files: rows,
    directories: directories,
    directoryModes: directoryModes
  };
  return {
    ...record,
    permissionDigest: permissionDigest(record)
  };
}

export function validateArtBundleContents({receipt: receipt, snapshot: snapshot, masters: masters, encoded: encoded, docs: docs, photos: photos, oldMasters: oldMasters, oldEncoded: oldEncoded, requiredSourcePaths: requiredSourcePaths}) {
  assert(receipt.schema === 1 && receipt.kind === 'selected-public-phone-art-bundle' && receipt.sourceApplication === 'NOT_APPLIED' && Array.isArray(receipt.files) && receipt.files.length > 0 && receipt.files.length <= 2048 && treeDigest(receipt.files) === receipt.artifact, 'Invalid complete art bundle');
  const files = new Map, sources = new Set;
  let total = 0;
  for (const row of receipt.files) {
    assert(safe(row.path) && /^(masters|encoded)\//.test(row.path) && !files.has(row.path) && Number.isInteger(row.bytes) && row.bytes > 0 && row.bytes <= 8 * 1024 * 1024 && /^[a-f0-9]{64}$/.test(row.sha256 || ''), 'Invalid generated art row');
    files.set(row.path, row);
    total += row.bytes;
    assert(total <= 64 * 1024 * 1024, 'Bundle exceeds64MiB');
  }
  assert(Array.isArray(requiredSourcePaths) && requiredSourcePaths.length >= PHONE_COMPOSERS.length && PHONE_COMPOSERS.every(path => requiredSourcePaths.includes(path)), 'Required source closure is incomplete');
  for (const row of receipt.sourceInputs || []) sources.add(row.path);
  assert(requiredSourcePaths.every(path => sources.has(path)), 'Bundle source receipt omits a required current composer/asset input');
  const actual = new Map(snapshot.files.map(row => [ row.path, row ]));
  assert(snapshot.files.every(row => files.has(row.path) || row.path === 'manifest.json' || row.path === '.hw-tool-owner'), 'Bundle contains undeclared data');
  assert([ ...files.values() ].every(row => actual.get(row.path)?.bytes === row.bytes && actual.get(row.path)?.sha256 === row.sha256), 'Complete bundle bodies do not match declared rows');
  assert(files.has('masters/masters.json') && files.has('encoded/manifest.json') && encoded.schema === 1 && encoded.files && Object.keys(encoded.files).length <= 2048, 'Bundle lacks complete art indexes');
  const names = docs.map(doc => doc.name);
  assert(Array.isArray(receipt.selected) && receipt.selected.length > 0 && new Set(receipt.selected).size === receipt.selected.length && receipt.selected.every(name => names.includes(name)) && Array.isArray(receipt.rendered) && new Set(receipt.rendered).size === receipt.rendered.length && receipt.rendered.every(name => receipt.selected.includes(name)), 'Invalid selected/rendered recipe receipt');
  for (const doc of docs) {
    const rec = masters[doc.name], master = files.get('masters/' + doc.name + '@3x.png');
    assert(rec && rec.doc === sha256(doc.html) && rec.w === doc.w && rec.h === doc.h && master?.sha256 === rec.png, 'Bundle master does not match current art recipe: ' + doc.name);
    const old = oldMasters[doc.name];
    if (old?.doc === rec.doc && old.w === rec.w && old.h === rec.h) assert(rec.png === old.png, 'Unchanged art was unnecessarily rebaked: ' + doc.name); else assert(receipt.rendered.includes(doc.name), 'Changed art is absent from rendered receipt: ' + doc.name);
    if (doc.mask) continue;
    const q = encodeFor(doc.name), key = rec.png.slice(0, 12) + '-' + q.avif + '-' + q.webp;
    for (const dpr of [ 2, 3 ]) for (const format of [ 'avif', 'webp' ]) assert(files.has('encoded/' + doc.name + '@' + dpr + 'x.' + key + '.' + format), 'Missing current art derivative: ' + doc.name);
  }
  for (const photo of photos) for (const width of photo.widths) for (const format of [ 'avif', 'webp' ]) assert(files.has('encoded/' + photo.name + '-' + width + '.' + photo.sha256.slice(0, 12) + '.' + format), 'Missing current photo derivative: ' + photo.name);
  for (const [name, row] of Object.entries(encoded.files)) {
    assert(/^[a-zA-Z0-9@.-]+\.(avif|webp)$/.test(name) && files.get('encoded/' + name)?.bytes === row.bytes && files.get('encoded/' + name)?.sha256 === row.sha256, 'Encoded index does not bind bundle body: ' + name);
    const old = oldEncoded.files[name];
    if (old) assert(old.bytes === row.bytes && old.sha256 === row.sha256, 'Existing reviewed derivative was requantized: ' + name);
  }
  assert([ ...files.keys() ].filter(path => /^encoded\/.+\.(avif|webp)$/.test(path)).every(path => encoded.files[path.slice(8)]), 'Unindexed encoded bundle body');
  validateNativeArtOrigins({
    masters: masters,
    encoded: encoded,
    oldMasters: oldMasters,
    oldEncoded: oldEncoded,
    canonicalToolchain: receipt.toolchain
  });
  return files;
}

export async function prepareArtApplication({bundle: bundle, projectRoot: projectRoot = defaultRoot} = {}) {
  projectRoot = await requireCoLocatedArtProject(projectRoot, {
    executingRoot: defaultRoot
  });
  assert(typeof bundle === 'string' && bundle.trim(), 'Application requires --bundle COMPLETE_DIRECTORY');
  bundle = resolve(bundle);
  const [{readContent: readContent}, {artDocs: artDocs}, {loadNight: loadNight}] = await Promise.all([ import('../source/mobile/content.mjs'), import('../source/mobile/art.mjs'), import('../source/mobile/night.mjs') ]);
  const raw = await withDeadline('read bundle receipt', () => readBuildInput(join(bundle, 'manifest.json'))), receipt = JSON.parse(raw);
  assert(receipt.schema === 1 && receipt.kind === 'selected-public-phone-art-bundle' && receipt.sourceApplication === 'NOT_APPLIED' && Array.isArray(receipt.files) && receipt.files.length > 0 && receipt.files.length <= 2048 && treeDigest(receipt.files) === receipt.artifact, 'Invalid complete art bundle');
  const origin = await createBuildOrigin({
    root: projectRoot
  }), known = new Set;
  await origin.read(join(projectRoot, 'tools/mobile-art-project.mjs'));
  assert(Array.isArray(receipt.sourceInputs) && receipt.sourceInputs.length > 0 && receipt.sourceInputs.length <= 2048, 'Bundle lacks bounded source receipt');
  for (const row of receipt.sourceInputs) {
    assert(row.origin === 'project' && safe(row.path) && !known.has(row.path) && Number.isInteger(row.bytes) && row.bytes > 0 && row.bytes <= 8 * 1024 * 1024 && /^[a-f0-9]{64}$/.test(row.sha256 || ''), 'Invalid source receipt row');
    known.add(row.path);
    const bytes = await origin.read(join(projectRoot, row.path));
    assert(bytes.length === row.bytes && sha256(bytes) === row.sha256, 'Current source does not match the regenerated bundle: ' + row.path);
    origin.release(join(projectRoot, row.path));
  }
  await origin.captureComposers();
  const inputs = await loadMobileSources({
    root: projectRoot,
    readInput: origin.read,
    inspectInput: origin.inspect,
    releaseInput: origin.release
  }), content = readContent(inputs.markup, {
    scriptSource: inputs.scriptSource
  }), night = await loadNight(projectRoot, {
    siteCss: inputs.artCss
  }), docs = artDocs(inputs.artSource, content.counts.groups, night);
  const source = join(projectRoot, 'source/mobile/art'), parent = join(projectRoot, 'source/mobile'), parentInfo = await withDeadline('validate art parent', () => lstat(parent)), old = await artTreeSnapshot(source), bundleBefore = await artTreeSnapshot(bundle);
  const readJSON = async path => JSON.parse(await withDeadline('read art index ' + path, () => readBuildInput(path))), masters = await readJSON(join(bundle, 'masters/masters.json')), encoded = await readJSON(join(bundle, 'encoded/manifest.json')), oldMasters = await readJSON(join(source, 'masters/masters.json')), oldEncoded = await readJSON(join(source, 'encoded/manifest.json'));
  const requiredSourcePaths = [ ...PHONE_COMPOSERS, 'tools/mobile-art-plan.mjs', 'tools/regenerate-mobile-art.mjs', ...origin.rows.map(row => row.path), 'source/mobile/art/masters/masters.json', 'source/mobile/art/encoded/manifest.json', ...docs.map(doc => 'source/mobile/art/masters/' + doc.name + '@3x.png').filter(path => old.files.some(row => row.path === path.slice('source/mobile/art/'.length))), ...Object.keys(oldEncoded.files).map(name => 'source/mobile/art/encoded/' + name) ];
  validateArtBundleContents({
    receipt: receipt,
    snapshot: bundleBefore,
    masters: masters,
    encoded: encoded,
    docs: docs,
    photos: inputs.photos,
    oldMasters: oldMasters,
    oldEncoded: oldEncoded,
    requiredSourcePaths: requiredSourcePaths
  });
  for (const doc of docs) {
    const bytes = await withDeadline('validate bundle master dimensions', () => readBuildInput(join(bundle, 'masters/' + doc.name + '@3x.png'))), dimensions = imageDimensions(bytes, 'png');
    assert(dimensions.width === doc.w * 3 && dimensions.height === doc.h * 3, 'Bundle master has incorrect pixel dimensions');
  }
  assert(parentInfo.isDirectory() && !parentInfo.isSymbolicLink(), 'Art parent must be a real directory');
  assertSupportedArtPermissions(old);
  const nativeOriginAdmission = validateNativeArtOrigins({
    masters: masters,
    encoded: encoded,
    oldMasters: oldMasters,
    oldEncoded: oldEncoded,
    canonicalToolchain: receipt.toolchain
  });
  await origin.verify();
  return {
    receipt: receipt,
    origin: origin,
    projectRoot: projectRoot,
    bundle: bundle,
    source: source,
    parent: parent,
    parentInfo: parentInfo,
    old: old,
    bundleBefore: bundleBefore,
    nativeOriginAdmission: nativeOriginAdmission
  };
}

export async function applyMobileArtBundle(options = {}) {
  const projectRoot = await requireCoLocatedArtProject(options.projectRoot ?? defaultRoot, {
    executingRoot: defaultRoot
  }), parent = join(projectRoot, 'source/mobile'), source = join(parent, 'art'), suffix = randomUUID(), stage = join(parent, '.art-stage-' + suffix), backup = join(parent, '.art-backup-' + suffix);
  assert(typeof options.bundle === 'string' && options.bundle.trim(), 'Application requires --bundle COMPLETE_DIRECTORY');
  // No source mutation begins without the concrete authenticated public guardian.
    const {runOwnedArtTransaction: runOwnedArtTransaction} = await (import('./mobile-art-runtime.mjs'));
  return runOwnedArtTransaction({
    timeoutMs: 12e4,
    shutdownMs: 8e3,
    output: stage,
    projectRoot: projectRoot,
    sourcePath: source
  }, async runtime => {
    assert(typeof runtime.withPhaseDeadline === 'function', 'Owned art runtime lacks independent source admission');
    const {receipt: receipt, origin: origin, bundle: bundle, parentInfo: parentInfo, old: old, bundleBefore: bundleBefore, nativeOriginAdmission: nativeOriginAdmission} = await runtime.withPhaseDeadline('phone art application admission', async () => {
      assert(typeof runtime.admitProducerInputs === 'function', 'Owned runtime lacks optional producer disk epoch');
      await runtime.admitProducerInputs('apply');
      return prepareArtApplication({
        ...options,
        projectRoot: projectRoot
      });
    }, {
      timeoutMs: 6e4
    });
    return runtime.withPhaseDeadline('guarded phone art application', async () => {
      assert(typeof runtime.registerArtTransaction === 'function' && typeof runtime.moveArtTransaction === 'function' && typeof runtime.updateArtTransaction === 'function' && typeof runtime.finishArtTransaction === 'function', 'Owned runtime lacks typed art transaction recovery');
      assert(!old.files.some(row => row.path === '.hw-tool-owner'), 'Existing art has an unreconciled ownership marker');
      const ownership = await runtime.ensureOutputDirectory(stage, {
        reason: 'in-progress art source transaction'
      });
      for (const path of old.directories) await runtime.deadline('preserve author directory ' + path, () => mkdir(join(stage, path), {
        recursive: true
      }), {
        timeoutMs: 5e3
      });
      const files = new Map;
      let total = 0;
      for (const row of receipt.files) {
        assert(safe(row.path) && /^(masters|encoded)\//.test(row.path) && !files.has(row.path) && Number.isInteger(row.bytes) && row.bytes > 0 && row.bytes <= 8 * 1024 * 1024 && /^[a-f0-9]{64}$/.test(row.sha256 || ''), 'Invalid generated art row');
        const bytes = await runtime.deadline('read generated art ' + row.path, () => readBuildInput(join(bundle, row.path)), {
          timeoutMs: 1e4
        });
        assert(bytes.length === row.bytes && sha256(bytes) === row.sha256, 'Bundle body changed: ' + row.path);
        total += bytes.length;
        assert(total <= 64 * 1024 * 1024, 'Bundle exceeds64MiB');
        await runtime.deadline('stage generated art ' + row.path, () => writeOutput(stage, row.path, bytes), {
          timeoutMs: 1e4
        });
        files.set(row.path, row);
      }
      // Unrelated author files/cached older assets survive the directory transaction byte for byte.
            for (const row of old.files.filter(row => !files.has(row.path))) {
        const bytes = await runtime.deadline('preserve unrelated art source ' + row.path, () => readBuildInput(join(source, row.path)), {
          timeoutMs: 1e4
        });
        assert(bytes.length === row.bytes && sha256(bytes) === row.sha256, 'Unrelated source changed');
        total += bytes.length;
        assert(total <= 64 * 1024 * 1024, 'Generated plus preserved art exceeds64MiB');
        await runtime.deadline('stage unrelated art source ' + row.path, () => writeOutput(stage, row.path, bytes), {
          timeoutMs: 1e4
        });
        files.set(row.path, row);
      }
      assert(files.has('masters/masters.json') && files.has('encoded/manifest.json'), 'Bundle lacks complete art indexes');
      const stagedBeforeModes = await artTreeSnapshot(stage, {
        ownership: ownership
      }), permissionPreservation = await runtime.deadline('preserve exact staged author permission modes', () => applyArtPermissions(stage, {
        old: old,
        bundle: bundleBefore,
        current: stagedBeforeModes
      }), {
        timeoutMs: 1e4
      });
      await origin.verify();
      const oldNow = await artTreeSnapshot(source), bundleNow = await artTreeSnapshot(bundle);
      assert(oldNow.dev === old.dev && oldNow.ino === old.ino && oldNow.digest === old.digest && oldNow.permissionDigest === old.permissionDigest && JSON.stringify(oldNow.directories) === JSON.stringify(old.directories), 'Author art changed before application');
      assert(bundleNow.dev === bundleBefore.dev && bundleNow.ino === bundleBefore.ino && bundleNow.digest === bundleBefore.digest && bundleNow.permissionDigest === bundleBefore.permissionDigest && JSON.stringify(bundleNow.directories) === JSON.stringify(bundleBefore.directories), 'Bundle changed before application');
      const next = await artTreeSnapshot(stage, {
        ownership: ownership
      });
      assert(next.files.length === files.size && next.files.every(row => files.get(row.path)?.bytes === row.bytes && files.get(row.path)?.sha256 === row.sha256), 'Prepared source stage does not match complete generated/preserved rows');
      assert.equal(next.permissionDigest, permissionPreservation.permissionDigest, 'Prepared source modes changed');
      assert(old.directories.every(path => next.directories.includes(path)), 'An author directory would be dropped');
      const descriptor = {
        schema: 1,
        type: 'mobile-art-directory',
        parent: {
          path: parent,
          ...directoryIdentity(parentInfo)
        },
        sourcePath: source,
        stagePath: stage,
        backupPath: backup,
        old: {
          dev: old.dev,
          ino: old.ino,
          digest: old.digest,
          files: old.files,
          directories: old.directories,
          rootMode: old.rootMode,
          directoryModes: old.directoryModes,
          permissionDigest: old.permissionDigest
        },
        new: {
          dev: next.dev,
          ino: next.ino,
          digest: next.digest,
          files: next.files,
          directories: next.directories,
          rootMode: next.rootMode,
          directoryModes: next.directoryModes,
          permissionDigest: next.permissionDigest
        },
        sourceInputRows: receipt.sourceInputs
      };
      const transaction = await runtime.registerArtTransaction(descriptor);
      await runtime.moveArtTransaction(transaction, {
        phase: 'OLD_BACKED_UP'
      });
      await runtime.moveArtTransaction(transaction, {
        phase: 'NEW_PROMOTED'
      });
      await runtime.updateArtTransaction(transaction, {
        phase: 'COMMITTED'
      });
      await runtime.finishArtTransaction(transaction);
      return {
        source: source,
        artifact: receipt.artifact,
        applied: true,
        visualAcceptance: 'NOT_ESTABLISHED_BY_APPLICATION',
        permissionPreservation: permissionPreservation,
        nativeOriginAdmission: nativeOriginAdmission,
        unrelatedFilesPreserved: old.files.filter(row => !receipt.files.some(file => file.path === row.path)).length
      };
    }, {
      timeoutMs: 6e4
    });
  });
}

if (import.meta.main ?? (process.argv[1] && import.meta.url === pathToFileURL(await withDeadline('canonical art application CLI entry', () => realpath(resolve(process.argv[1])))).href)) {
  const {values: values} = parseArgs({
    options: {
      help: {
        type: 'boolean'
      },
      bundle: {
        type: 'string'
      },
      root: {
        type: 'string'
      }
    }
  });
  if (values.help) console.log('Usage: node tools/apply-mobile-art-bundle.mjs --bundle COMPLETE_DIRECTORY [--root FORK]\nExplicit guarded source/mobile/art update; --root must resolve to this tools project. Requires the packaged owned public transaction guardian.'); else console.log(JSON.stringify(await applyMobileArtBundle({
    bundle: values.bundle,
    projectRoot: values.root
  })));
}
