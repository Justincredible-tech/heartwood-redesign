// Focused public regression (batch-078 A11Y-01 corrections): under prefers-reduced-motion the
// site-layer leaf transition is reset, and the night firefly face is in the critter pause list.
// Reads the authored stylesheet only and evaluates the cascade for a bare .leaf element: pure Node,
// no browser, no build. Runtime stillness (live firefly, actual leaf hover) needs the browser lane.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8');

// Minimal authored-CSS scanner: every rule with its selector, body, source offset and the enclosing
// at-rule text. Authored sheets here nest one @media level; braces inside rule bodies are consumed whole.
// Comments are removed first: a comment sitting between rules would otherwise become part of the next
// selector and hide the @media block behind it.
function scanRules(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const rules = [];
  const stack = [];
  let i = 0;
  for (;;) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open);
    const closes = head.split('}').length - 1;
    for (let n = 0; n < closes && stack.length; n++) stack.pop();
    const selector = head.slice(head.lastIndexOf('}') + 1).trim();
    if (selector.startsWith('@')) {
      stack.push(selector);
      i = open + 1;
      continue;
    }
    let depth = 1;
    let j = open + 1;
    for (; j < css.length && depth > 0; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
    }
    rules.push({ selector, body: css.slice(open + 1, j - 1), at: open, media: stack.join(' ') });
    i = j;
  }
  return rules;
}

const listHas = (selector, className) => selector.split(',').map(part => part.trim()).includes(className);

test('reduced motion resets the site-layer leaf transition after the leaf rule it must defeat', async () => {
  const css = await read('source/css/heartwood-site.css');
  const rules = scanRules(css);
  const leafRules = rules.filter(rule => rule.body.includes('transition') && listHas(rule.selector, '.leaf'));
  assert(leafRules.length >= 2, 'The authored and reduced-motion .leaf transition rules must both exist');
  // A bare .leaf element: every candidate selector is a single class, so equal specificity means the
  // last matching rule in source order wins whenever its media condition applies.
  const reduced = leafRules.filter(rule => !rule.media || rule.media.includes('(prefers-reduced-motion: reduce)'));
  const winner = reduced[reduced.length - 1];
  assert.match(winner.media, /prefers-reduced-motion: reduce/, 'The winning reduced-motion rule must be media-gated');
  assert.match(winner.body, /transition:\s*none/, 'Under reduced motion a leaf must not animate its transform or filter');
  // The always-applied authored leaf transition is the one the reset has to outrank; it must stay
  // authored before the reset rather than after it.
  const always = leafRules.filter(rule => !rule.media);
  assert.ok(always.length >= 1, 'The authored leaf transition must remain');
  for (const rule of always) {
    assert.ok(rule.at < winner.at, 'The always-applied leaf transition must stay before the reduced-motion reset');
  }
  // Nothing after the reset may re-declare a bare-leaf transition inside or outside the media block.
  const after = leafRules.filter(rule => rule.at > winner.at);
  assert.deepEqual(after, [], 'No bare .leaf transition may re-declare after the reduced-motion reset');
});

test('the reduced-motion critter pause list includes the night firefly face and stays in step with the runtime list', async () => {
  const css = await read('source/css/heartwood-site.css');
  const rules = scanRules(css);
  const reduced = rules.filter(rule => rule.media.includes('(prefers-reduced-motion: reduce)') && /animation-play-state:\s*paused/.test(rule.body));
  assert.equal(reduced.length, 1, 'Exactly one reduced-motion critter pause rule is expected');
  const rule = reduced[0];
  assert.match(rule.selector, /:root :is\(/, 'The pause rule keeps its specificity-raising :root wrapper');
  const species = /:is\(([^)]*)\)/.exec(rule.selector);
  assert(species, 'The pause rule must list the critter parts in :is()');
  const speciesList = species[1].split(',').map(name => name.trim());
  assert(speciesList.includes('.bee__face'), 'The night firefly face must pause under reduced motion');
  assert(speciesList.includes('.bee__bob') && speciesList.includes('.bee__wing'), 'The firefly body parts stay covered');
  // The runtime lifecycle pause rule already carried .bee__face (element, ::before and ::after share
  // one selector list); the A11Y-01 defect was exactly the two lists disagreeing, so they must stay equal.
  const runtime = rules.filter(candidate => !candidate.media && /animation-play-state:\s*paused\s*!important/.test(candidate.body));
  assert.equal(runtime.length, 1, 'The runtime pause rule must stay present');
  const runtimeSpecies = /:is\(\.is-motion-paused, \.is-motion-hidden\) :is\(([^)]*)\)/.exec(runtime[0].selector);
  assert(runtimeSpecies, 'The runtime pause rule must gate on the lifecycle classes');
  const runtimeList = runtimeSpecies[1].split(',').map(name => name.trim());
  assert.deepEqual([...new Set(speciesList)].sort(), [...new Set(runtimeList)].sort(),
    'Reduced-motion and lifecycle pause lists must cover the same critter parts');
});

test('leaf transitions stay on bare-class selectors so the reduced-motion reset cannot be outranked', async () => {
  const css = await read('source/css/heartwood-site.css');
  const rules = scanRules(css);
  const isReduced = rule => rule.media.includes('(prefers-reduced-motion: reduce)');
  // A compound selector (button.leaf, .leaf.foo, [data-x].leaf, .leaf:hover, ...) carries more specificity
  // than the bare .leaf the reset is written against; such a rule could keep a leaf animating under reduced
  // motion while this model (and a reviewer) sees the reset win. Keep every leaf transition on the bare
  // class. Class names are tokenized so .leaftag and .leafmark are not treated as .leaf.
  const compound = [];
  for (const rule of rules) {
    if (!rule.body.includes('transition') || isReduced(rule)) continue;
    for (const part of rule.selector.split(',').map(selector => selector.trim())) {
      const classes = part.match(/\.[A-Za-z_][A-Za-z0-9_-]*/g) || [];
      const referencesLeaf = classes.some(name => name === '.leaf');
      if (referencesLeaf && part !== '.leaf') compound.push(part + ' @' + rule.at);
    }
  }
  assert.deepEqual(compound, [], 'Leaf transitions must use the bare .leaf selector so the reduced-motion cascade model can compare them: ' + compound.join('; '));
});
