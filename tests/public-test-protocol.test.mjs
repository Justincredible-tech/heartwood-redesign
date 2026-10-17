import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeNodeTestDirectives, summarizePublicTests, validatePublicTestResult,
} from '../tools/public-test-results.mjs';

const file = 'tests/owned-protocol.test.mjs';
const optional = {art: 'NOT_RUN', encoder: 'NOT_RUN'};
const completion = flags => ({type: 'pass', file, ...flags});

test('Node markers are omissions even when their reason is empty or false', () => {
  // These are actual Node22 output shapes, not test-input option semantics.
  for (const data of [{skip: ''}, {skip: false}, {skip: true}, {todo: ''}, {todo: false}, {todo: true}]) {
    const flags = normalizeNodeTestDirectives(data);
    const result = summarizePublicTests([file], [completion(flags)], optional);
    assert.equal(result.status, 'FAIL');
    assert.equal(result.passed, 0);
    assert.equal(result.skipped + result.todo, 1);
    assert.throws(() => validatePublicTestResult(result, [file]));
  }
});

test('ordinary Node events have no directive and Python false flags remain ordinary', () => {
  for (const flags of [normalizeNodeTestDirectives({}), {skip: false, todo: false}, {}]) {
    const result = summarizePublicTests([file], [completion(flags)], optional);
    assert.equal(validatePublicTestResult(result, [file]), result);
    assert.equal(result.passed, 1);
    assert.equal(result.skipped, 0);
    assert.equal(result.todo, 0);
    assert.equal(result.optionalNative, optional);
  }
});

test('shared completion flags reject malformed supplied values instead of coercing them', () => {
  for (const key of ['skip', 'todo']) {
    for (const value of ['', null, 0, 'false', [], {}, NaN]) {
      const result = summarizePublicTests([file], [completion({[key]: value})], optional);
      assert.equal(result.status, 'FAIL');
      assert.equal(result.passed, 0);
      assert(result.errors.includes('Invalid test completion directive flags'));
      assert.throws(() => validatePublicTestResult(result, [file]));
    }
  }
});
