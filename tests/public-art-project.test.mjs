// Metadata-only public API controls; no source preparation, native lifecycle or output allocation.
import test from 'node:test';

import assert from 'node:assert/strict';

import { join, resolve } from 'node:path';

import { realpath } from 'node:fs/promises';

import { requireCoLocatedArtProject } from '../tools/mobile-art-project.mjs';

import { prepareArtRegeneration, describeArtRegeneration, regenerateMobileArt } from '../tools/regenerate-mobile-art.mjs';

import { prepareArtApplication, applyMobileArtBundle } from '../tools/apply-mobile-art-bundle.mjs';

const root = resolve(import.meta.dirname, '..'), different = resolve(root, '..'), failure = error => error.code === 'HW_ART_DIFFERENT_PROJECT' && /own public tools/.test(error.message);

test('same canonical project and dot-component aliases retain one executing root', async () => {
  const expected = await realpath(root);
  for (const selected of [ root, join(root, 'tools', '..'), join(root, '.') ]) assert.equal(await requireCoLocatedArtProject(selected, {
    executingRoot: root
  }), expected);
});

test('another existing project and invalid roots reject without reading source or allocating', async () => {
  await assert.rejects(requireCoLocatedArtProject(different, {
    executingRoot: root
  }), failure);
  for (const selected of [ '', null, 4, 'x'.repeat(4097) ]) await assert.rejects(requireCoLocatedArtProject(selected, {
    executingRoot: root
  }));
});

test('all preparation and native entry APIs reject different-root requests before their work', async () => {
  for (const operation of [ () => prepareArtRegeneration({
    projectRoot: different
  }), () => describeArtRegeneration({
    projectRoot: different
  }), () => regenerateMobileArt({
    projectRoot: different
  }), () => prepareArtApplication({
    projectRoot: different
  }), () => applyMobileArtBundle({
    projectRoot: different
  }) ]) await assert.rejects(operation(), failure);
  await assert.rejects(applyMobileArtBundle({
    projectRoot: root
  }), /Application requires --bundle/);
});
