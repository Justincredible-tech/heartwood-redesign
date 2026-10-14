import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createCommandRunner} from './delivery-dry-run.mjs';
import {summarizePublicTests, validatePublicTestResult} from './public-test-results.mjs';

export function publicPythonCommand(environment = process.env) {
  const command = environment.HW_PUBLIC_TEST_PYTHON || 'python';
  const args = JSON.parse(environment.HW_PUBLIC_TEST_PYTHON_ARGS || '[]');
  assert(typeof command === 'string' && command.length > 0 && !command.includes('\0'),
    'Invalid HW_PUBLIC_TEST_PYTHON executable');
  assert(Array.isArray(args) && args.length <= 32 && args.every(argument => typeof argument === 'string' &&
    argument.length <= 4096 && !argument.includes('\0')), 'HW_PUBLIC_TEST_PYTHON_ARGS must be a JSON argv array');
  return {command, args};
}

// A file-backed loader supports names such as review-qwen-package.test.py,
// preserves exact file ownership, and leaves result admission to the shared Node validator.
const LOADER = String.raw`import importlib.util
import json
import sys
import unittest
from pathlib import Path

root = Path(sys.argv[1])
files = json.loads(sys.argv[2])
sys.path.insert(0, str(root))
sys.path.insert(0, str(root / 'tools'))
events = []
errors = []
owners = {}
suite = unittest.TestSuite()

def own_tests(value, filename):
    if isinstance(value, unittest.TestSuite):
        for test in value:
            own_tests(test, filename)
    else:
        owners[id(value)] = filename

for index, filename in enumerate(files):
    try:
        name = 'heartwood_public_' + str(index)
        spec = importlib.util.spec_from_file_location(name, root / filename)
        if spec is None or spec.loader is None:
            raise RuntimeError('Cannot load public Python test: ' + filename)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        loaded = unittest.defaultTestLoader.loadTestsFromModule(module)
        own_tests(loaded, filename)
        suite.addTests(loaded)
    except Exception as error:
        errors.append(filename + ': ' + repr(error))

class RecordedResult(unittest.TextTestResult):
    def record(self, test, kind, skip=False, todo=False):
        owner = getattr(test, 'test_case', test)
        events.append({'type': kind, 'file': owners.get(id(owner)), 'skip': skip, 'todo': todo})

    def addSuccess(self, test):
        super().addSuccess(test)
        self.record(test, 'pass')

    def addFailure(self, test, error):
        super().addFailure(test, error)
        self.record(test, 'fail')

    def addError(self, test, error):
        super().addError(test, error)
        self.record(test, 'fail')

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self.record(test, 'pass', skip=True)

    def addExpectedFailure(self, test, error):
        super().addExpectedFailure(test, error)
        self.record(test, 'pass', todo=True)

    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test)
        self.record(test, 'fail')

    def addSubTest(self, test, subtest, error):
        super().addSubTest(test, subtest, error)
        if error is not None:
            self.record(test, 'fail')

result = unittest.TextTestRunner(verbosity=2, resultclass=RecordedResult).run(suite)
for error in errors:
    print(error, file=sys.stderr)
print('HEARTWOOD_PUBLIC_PYTHON_EVENTS ' + json.dumps({
    'schema': 1, 'files': files, 'events': events, 'errors': errors
}), flush=True)
if errors or not result.wasSuccessful():
    raise SystemExit(1)
`;

export async function executePublicPythonTests(root, plan, deadlineAt) {
  const files = plan.pythonFiles;
  assert(Array.isArray(files) && files.length > 0 && new Set(files).size === files.length &&
    files.every(file => /^tests\/[^/\\\0]+\.test\.py$/.test(file)), 'Invalid public Python test roster');
  const timeoutMs = Math.min(30000, deadlineAt - Date.now());
  assert(timeoutMs >= 100, 'Public Python test deadline has expired');
  const interpreter = publicPythonCommand();
  const runner = await createCommandRunner({timeoutMs});
  let cancellationError;
  const stop = (name, exitCode) => {
    cancellationError ||= Object.assign(Error('Public Python tests stopped by ' + name), {exitCode});
    void runner.close();
  };
  const interrupt = () => stop('SIGINT', 130);
  const terminate = () => stop('SIGTERM', 143);
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  try {
    const scratch = await runner.makeScratch();
    const loader = join(scratch, 'public-unittest-loader.py');
    await writeFile(loader, LOADER, {flag: 'wx'});
    const execution = await runner.run('public-python-tests', interpreter.command,
      [...interpreter.args, loader, root, JSON.stringify(files)], {
        cwd: root, env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'},
        timeoutMs: Math.max(1, Math.min(timeoutMs, deadlineAt - Date.now())), maxBytes: 2 * 1024 * 1024
      });
    if (cancellationError) throw cancellationError;
    if (execution.exitCode !== 0) {
      throw Object.assign(Error('Public Python tests failed: ' + (execution.error ||
        execution.stderr.toString('utf8').slice(-4000))), {exitCode: execution.exitCode});
    }
    const prefix = 'HEARTWOOD_PUBLIC_PYTHON_EVENTS ';
    const lines = execution.stdout.toString('utf8').split(/\r?\n/).filter(line => line.startsWith(prefix));
    assert.equal(lines.length, 1, 'Exactly one Python test completion is required');
    const completed = JSON.parse(lines[0].slice(prefix.length));
    assert.equal(completed.schema, 1, 'Invalid Python completion schema');
    assert.deepEqual(completed.files, files, 'Python test membership changed');
    assert(Array.isArray(completed.errors) && completed.errors.length === 0, 'Python test modules did not load');
    assert(Array.isArray(completed.events), 'Missing Python test execution events');
    return validatePublicTestResult(summarizePublicTests(files, completed.events, plan.optionalNative), files);
  } catch (error) {
    throw cancellationError || error;
  } finally {
    let cleanup;
    let cleanupError;
    try {cleanup = await runner.close();} catch (error) {cleanupError = error;}
    finally {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
    }
    if (cancellationError) {
      if (cleanupError) cancellationError.message += '; cleanup: ' + cleanupError.message;
      if (cleanup && (cleanup.status !== 'CLEAN' || cleanup.errors.length > 0)) {
        cancellationError.message += '; cleanup: ' + JSON.stringify(cleanup);
      }
      throw cancellationError;
    }
    if (cleanupError) throw cleanupError;
    assert(cleanup.status === 'CLEAN' && cleanup.errors.length === 0, 'Public Python test cleanup failed');
  }
}
