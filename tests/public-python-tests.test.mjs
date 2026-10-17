import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createCommandRunner} from '../tools/delivery-dry-run.mjs';
import {publicTestPlan} from '../tools/test-public.mjs';
import {NATIVE_ART_TEST_FILES, NATIVE_TOOLCHAIN_TEST_FILES} from './fixtures/native-art-test-support.mjs';

const api = await import('../tools/public-python-tests.mjs').catch(() => null);

async function fixture(run) {
  const owner = await createCommandRunner({timeoutMs: 10000});
  try {
    const root = await owner.makeScratch();
    await mkdir(join(root, 'tests'));
    return await run(root);
  } finally {
    const cleanup = await owner.close();
    assert.equal(cleanup.status, 'CLEAN');
  }
}

test('the public roster includes every regular Python regression file', () => fixture(async root => {
  for (const name of [...NATIVE_ART_TEST_FILES, ...NATIVE_TOOLCHAIN_TEST_FILES, 'portable.test.mjs']) {
    await writeFile(join(root, 'tests', name), '');
  }
  await writeFile(join(root, 'tests/review-one.test.py'), '');
  await writeFile(join(root, 'tests/review-two.test.py'), '');
  const plan = await publicTestPlan(root, {nativeArt: false, nativeToolchain: false});
  assert.deepEqual(plan.pythonFiles, ['tests/review-one.test.py', 'tests/review-two.test.py']);
  assert(plan.files.includes('tests/portable.test.mjs'));
  assert(plan.files.includes('tests/review-two.test.py'));
  assert(plan.nodeFiles.every(file => file.endsWith('.mjs')));
}));

test('Python interpreter configuration is argv, with no shell or platform path', () => {
  assert(api, 'public Python test implementation is required');
  assert.deepEqual(api.publicPythonCommand({}), {command: 'python', args: []});
  assert.deepEqual(api.publicPythonCommand({HW_PUBLIC_TEST_PYTHON: 'executable with spaces',
    HW_PUBLIC_TEST_PYTHON_ARGS: '["argument with spaces", "-3"]'}),
  {command: 'executable with spaces', args: ['argument with spaces', '-3']});
  for (const value of ['null', '{}', '"not argv"', '[1]', '{bad json']) {
    assert.throws(() => api.publicPythonCommand({HW_PUBLIC_TEST_PYTHON_ARGS: value}));
  }
});

test('the file-backed loader executes dotted and hyphenated Python names', {timeout: 10000}, () =>
  fixture(async root => {
    assert(api, 'public Python test implementation is required');
    await writeFile(join(root, 'tests/review-hyphen.test.py'),
      'import unittest\nclass Actual(unittest.TestCase):\n    def test_value(self): self.assertEqual(2+2,4)\n');
    const result = await api.executePublicPythonTests(root, {
      pythonFiles: ['tests/review-hyphen.test.py'], optionalNative: {art: 'NOT_RUN', encoder: 'NOT_RUN'}
    }, Date.now() + 4000);
    assert.equal(result.tests, 1);
    assert.equal(result.passed, 1);
    assert.deepEqual(result.roster.map(row => row.file), ['tests/review-hyphen.test.py']);
  }));

test('zero tests, skips and module errors cannot become Python passes', {timeout: 10000}, () =>
  fixture(async root => {
    assert(api, 'public Python test implementation is required');
    const sources = new Map([
      ['empty.test.py', 'VALUE = 1\n'],
      ['skip.test.py', 'import unittest\nclass Bad(unittest.TestCase):\n' +
        '    @unittest.skip("fixture omission")\n    def test_value(self): pass\n'],
      ['error.test.py', 'raise RuntimeError("fixture module error")\n']
    ]);
    for (const [name, source] of sources) {
      await writeFile(join(root, 'tests', name), source);
      await assert.rejects(api.executePublicPythonTests(root, {
        pythonFiles: ['tests/' + name], optionalNative: {art: 'NOT_RUN', encoder: 'NOT_RUN'}
      }, Date.now() + 4000), name === 'error.test.py' ? /fixture module error/ : /successful public-test completion/);
    }
  }));

test('a hanging Python test hits the shared deadline and cleans its owned process', {timeout: 10000}, () =>
  fixture(async root => {
    assert(api, 'public Python test implementation is required');
    await writeFile(join(root, 'tests/hang.test.py'),
      'import time, unittest\nfrom pathlib import Path\nclass Hanging(unittest.TestCase):\n' +
      '    def test_hang(self):\n        Path(__file__).with_name("started.txt").write_text("started")\n' +
      '        time.sleep(5)\n');
    const started = Date.now();
    await assert.rejects(api.executePublicPythonTests(root, {
      pythonFiles: ['tests/hang.test.py'], optionalNative: {art: 'NOT_RUN', encoder: 'NOT_RUN'}
    }, Date.now() + 500), /deadline|timed out/);
    assert.equal(await readFile(join(root, 'tests/started.txt'), 'utf8'), 'started',
      'The hanging testcase must actually begin; slow startup is not hang evidence');
    assert(Date.now() - started < 2000, 'Python timeout should retire work promptly');
  }));
