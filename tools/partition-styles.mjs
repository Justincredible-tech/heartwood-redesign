import assert from 'node:assert/strict';

export const artworkBoundary = '<div class="scene" aria-hidden="true">';
// A synchronous external script waits for preceding stylesheets and prevents
// parsing artwork whose positioning rules have not arrived yet. It deliberately
// performs no DOM work; the actual application scripts remain deferred.
export const artworkBarrierSource = '"use strict";\n';

// The compiler gives each static declaration a distinct class in first-use
// order. Keep a contiguous prefix through the last class used before the
// artwork, and put the untouched remainder before that artwork. The stage's
// existing dimensions and sky must precede the link so the first heading paint
// retains its intended background while artwork arrives. Concatenating
// the two sheets must recover every byte of the unsplit cascade. In particular,
// trailing overrides stay last; selector-specificity guesses are unnecessary.
export function partitionStyles({html, leadingCss, compiledRules, trailingCss}) {
  const parts = html.split(artworkBoundary);
  assert.equal(parts.length, 2, 'Expected exactly one artwork scene boundary');
  assert(parts[0].includes('<div class="stage" id="stage">'),'Original sky stage must precede artwork boundary');
  const indices = new Map(compiledRules.map((rule, index) => [rule.className, index]));
  assert.equal(indices.size, compiledRules.length, 'Duplicate compiled style class');
  let boundary = 0;
  for (const match of parts[0].matchAll(/\bclass="([^"]*)"/g)) {
    for (const className of match[1].split(/\s+/).filter(name => name.startsWith('hw-s-'))) {
      assert(indices.has(className), 'Missing compiled rule for ' + className);
      boundary = Math.max(boundary, indices.get(className) + 1);
    }
  }
  return {
    base: leadingCss + compiledRules.slice(0, boundary).map(rule => rule.css).join(''),
    artwork: compiledRules.slice(boundary).map(rule => rule.css).join('') + trailingCss,
  };
}
