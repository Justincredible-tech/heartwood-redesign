// Focused public test (Family B): forceColourScheme handles case variants and fails closed on
// comment-interleaved night queries. Pure Node; portable (no POSIX paths, no toolchain needs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {forceColourScheme} from '../tools/mobile-theme.mjs';

const lower = '@media (prefers-color-scheme: dark) { .a{color:red} }';
const upper = '@media (PREFERS-COLOR-SCHEME: Dark) { .b{color:blue} }';
const comment = '@media (prefers-color-scheme: /*c*/ dark) { .c{color:green} }';

test('lowercase night queries are stripped in light and inlined in dark', () => {
  assert.ok(!forceColourScheme(lower, 'light').includes('color:red'));
  assert.ok(forceColourScheme(lower, 'dark').includes('.a{color:red}'));
});

test('case variants of the night query are rewritten, never kept as OS-dependent CSS', () => {
  const light = forceColourScheme(upper, 'light');
  const dark = forceColourScheme(upper, 'dark');
  assert.ok(!/prefers-color-scheme/i.test(light));
  assert.ok(!light.includes('color:blue'));
  assert.ok(dark.includes('.b{color:blue}'));
});

test('comment-interleaved night queries fail closed instead of shipping silently', () => {
  assert.throws(() => forceColourScheme(comment, 'light'), /Unsupported phone night media query/);
  assert.throws(() => forceColourScheme(comment, 'dark'), /Unsupported phone night media query/);
});

test('the reduced-motion conjunction keeps its contract', () => {
  const motion = '@media (prefers-color-scheme: dark) and (prefers-reduced-motion: reduce) { .d{color:gray} }';
  assert.ok(!/prefers-color-scheme/i.test(forceColourScheme(motion, 'light')));
  assert.match(forceColourScheme(motion, 'dark'), /@media \(prefers-reduced-motion: reduce\) \{ .d\{color:gray\} \}/);
});
