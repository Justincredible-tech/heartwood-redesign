// Focused boundary regressions (codex-057 item C), cheap and data-fixture based:
// D3 — the night-off `data-hw-mode` anchor removal must match the exact attribute name, never a longer one.
// D1 — the phone caption rewrite must be asserted, so a source caption change fails closed instead of
//      silently shipping touch instructions after the network overlay has been excluded.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {applySceneExclusions} from '../source/build-features.mjs';
import {phoneHtmlFeatures} from '../tools/mobile-feature-source.mjs';

const realMarkup = await readFile(new URL('../source/heartwood-site.html', import.meta.url), 'utf8');
const exactModeAttributes = html => (html.match(/\sdata-hw-mode(?=[\s>=/])/g) ?? []).length;

test('D3: the night-off anchor removal distinguishes data-hw-mode from data-hw-mode-extra', () => {
  const fixture = realMarkup.replace('</body>',
    '<a href="taste/" data-hw-mode>Night</a><a href="keep" data-hw-mode-extra>Extra</a><a href="x" xdata-hw-mode>Nope</a></body>');
  assert.equal(exactModeAttributes(fixture), 2, 'fixture carries the real anchor plus one injected exact anchor');
  const changed = applySceneExclusions(fixture, ['night']);
  assert.equal(exactModeAttributes(changed), 0, 'both exact mode-switch anchors are removed when night is excluded');
  assert.ok(changed.includes('data-hw-mode-extra'), 'a longer attribute name is preserved');
  assert.ok(changed.includes('xdata-hw-mode'), 'an attribute name merely ending in data-hw-mode is preserved');
  assert.equal(exactModeAttributes(applySceneExclusions(fixture, [])), 2, 'with night enabled nothing is removed');
});

test('D1: the phone caption rewrite is asserted against drifted captions, and partial fixtures still pass', () => {
  const overlays = '<svg class="net__path"><path/></svg><div class="net__pin">pin</div><script type="application/json" id="hw-net">{}</script>';
  const captioned = overlays + '<p>Every member group is a spore on the roots. Tap near one to find it.</p>';
  const changed = phoneHtmlFeatures(captioned, {night: true, networkEffects: false});
  assert.ok(changed.includes('Every member group is a spore on the roots.'), 'the short caption ships');
  assert.ok(!changed.includes('Tap near one to find it.'), 'the touch instruction is dropped with the targets');
  const drifted = overlays + '<p>Each member group is a spore on the roots. Tap near one to find it.</p>';
  assert.throws(() => phoneHtmlFeatures(drifted, {night: true, networkEffects: false}),
    /caption changed/i, 'a drifted caption fails closed instead of shipping unreconciled instructions');
  assert.doesNotThrow(() => phoneHtmlFeatures(overlays, {night: true, networkEffects: false}),
    'partial fixtures without the caption keep working');
});
